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

import { parsePollInterval } from "../src/poller";
import { rotationGroupsOf } from "../src/rotation";
import { ART_LOOKS, ART_STARS, ART_TONES, artFits, drawnStars } from "../src/ui/deck-art";
import { PANEL } from "../src/i18n-catalog";
import { measureFor } from "../src/ui/reading-format";

type Settings = Record<string, unknown>;
type Model = {
	readingSummary(kind: string, settings: Settings, preview: unknown, labelOf: (key: string) => string | null): string;
	displaySummary(kind: string, settings: Settings, globals: Settings, preview: unknown): string;
	alertsSummary(kind: string, settings: Settings, preview: unknown): string;
	keyInteractionSummary(settings: Settings, detailsSupported?: boolean | null): string;
	pressBehavior(settings: Settings): string;
	detailsBehavior(behavior: string): boolean;
	keyAlertTimingSummary(settings: Settings): string;
	patchKeyAlertRule(raw: unknown, fileKey: string, patch: Record<string, unknown>, unit?: string): Record<string, unknown>;
	dialInteractionSummary(settings: Settings, preview: unknown): string;
	groupsActive(settings: Settings): boolean;
	claimedGroups(settings: Settings): string[][];
	gestureWords(command: string, settings: Settings): string;
	controlSummary(settings: Settings): { command: string; target: string };
	advancedSummary(globals: Settings): string;
	sharedDefaultsSummary(globals: Settings, resolvedTheme?: string): string;
	connectionSummary(globals: Settings): string;
	splitKeyList(raw: unknown, cap?: number): { known: string[]; kept: unknown[]; keptAt: number[] };
	mergeKept(known: unknown[], kept: unknown[], keptAt: number[]): unknown[];
	patchEntry(raw: unknown, base: unknown, current: Record<string, unknown>, fields: string[]): Record<string, unknown>;
	patchNames(raw: unknown, key: string, name: string): Record<string, unknown>;
	patchColors(raw: unknown, updates: Record<number, string>, defaults: string[]): unknown[];
	themeName(id: unknown): string;
	accentWordsLook(settings: Settings): boolean;
	dialAccentWords(settings: Settings): boolean;
	keyBackground(settings: Settings): string;
	keyAccentWords(settings: Settings): boolean;
	READING_FORMATS_CAP: number;
	FORMAT_DECIMALS: readonly string[];
	readingFormatOf(raw: unknown, keys: string[]): { key: string; entry: Record<string, unknown> } | null;
	patchReadingFormat(raw: unknown, keys: string[], fileKey: string, patch: Record<string, string>): { next?: Record<string, unknown>; refused?: string };
	formatRowPlan(settings: Settings, same: (a: string, b: string) => boolean): Array<{ slot: number; key: string; kind: string; of?: number }>;
	formatsSummary(rows: Array<{ name: string; unit: string; decimals: string }>): string;
	sortedJson(value: unknown): string;
	looksGenOf(raw: unknown): number;
	ownLooksLine(count: unknown): string;
	stampOwnLooks(doc: unknown, kind: string, gen: unknown): unknown;
	sharedDocToWrite(pasted: unknown, current: unknown): Record<string, unknown>;
	sharedDocForWell(globals: unknown): Record<string, unknown>;
	ART_LOOKS: string[];
	STARS: string[];
	TONES: string[];
	isArtLook(v: unknown): boolean;
	lookOf(v: unknown): string | null;
	drawnStars(look: string, stars: string): string;
	skyShown(stored: unknown, fallback: string): string;
	sharedSkyOf(globals: unknown, kind: string): { stars: string; tone: string };
	lightTheme(bg: unknown): boolean;
	STARS_TEXT: Record<string, [string, string]>;
	TONE_TEXT: Record<string, [string, string]>;
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
	it("a stored rm: key reads as the plain missing line, whatever else a preview carries", () => {
		const missing = (extra: Record<string, unknown>): string => model.readingSummary("key", { readingKey: "rm:WyJERVNLVE9QLTdRMiIsImYwMDAwNTAxIiwwLCIxMDAwMDAwIl0" }, { state: "ok", missing: true, ...extra }, noLabel);
		assert.equal(missing({}), "Saved reading not found in HWiNFO");
		assert.equal(missing({ remote: { state: "offline", label: "DESKTOP-A" } }), "Saved reading not found in HWiNFO");
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
	it("names a dial's rotation and never the reading on the dial, so a step leaves the line as it is", () => {
		const preview = { state: "ok", missing: false, reading: { label: "GPU", source: "S" } };
		assert.equal(model.readingSummary("dial", { readingKey: "g", rotationKeys: ["g", "h", "i"] }, preview, noLabel), "Rotation: 3 readings");
		assert.equal(model.readingSummary("dial", { readingKey: "g", rotationGroups: [{ keys: ["g"] }, { keys: ["h"] }] }, preview, noLabel), "Rotation: 2 groups");
		assert.equal(model.readingSummary("dial", { readingKey: "g" }, preview, noLabel), "Rotation: this sensor's readings");
		// The same line whatever reading a step brings, and whatever the dial's own label.
		const other = { state: "ok", missing: false, reading: { label: "GPU Memory Junction Temperature", source: "S" } };
		assert.equal(model.readingSummary("dial", { readingKey: "h", rotationKeys: ["g", "h", "i"] }, other, noLabel), "Rotation: 3 readings");
		assert.equal(model.readingSummary("dial", { readingKey: "g", label: "Mine", rotationKeys: ["g", "h", "i"] }, preview, noLabel), "Rotation: 3 readings");
		// A key does not step: its line still names its reading.
		assert.equal(model.readingSummary("key", { readingKey: "g" }, preview, noLabel), "GPU");
	});
	it("counts only groups the runtime uses, and a one-reading set as a set", () => {
		const preview = { state: "ok", missing: false, reading: { label: "GPU", source: "S" } };
		// One non-empty group (the other empty, the third only repeating a claimed key): the runtime runs the flat set.
		const settings = { readingKey: "g", rotationKeys: ["g", "h"], rotationGroups: [{ keys: ["g", "h"] }, { keys: [] }, { keys: ["g"] }, "marker"] };
		assert.equal(model.readingSummary("dial", settings, preview, noLabel), "Rotation: 2 readings");
		assert.equal(model.readingSummary("dial", { readingKey: "g", rotationKeys: ["g"] }, preview, noLabel), "Rotation: 1 reading");
	});
});

describe("display summary", () => {
	it("marks inherited choices as shared and own choices without the mark", () => {
		// The theme is not summarized here: it sits in the always-open band
		// above the sections (palette study).
		const shared = model.displaySummary("key", {}, {}, { effective: effective({ text: { mode: "dim", applied: "dim", own: false, color: null, dimSecondary: false } }) });
		assert.equal(shared, "Current value · auto decimals · dimmed text (shared)");
		const own = model.displaySummary("key", { statMode: "max", decimals: "1" }, {}, { effective: effective({ theme: { id: "ember", drawn: "ember", own: true, unknown: false }, text: { mode: "custom", applied: "custom", own: true, color: "#8A2B2B", dimSecondary: true } }) });
		assert.equal(own, "Maximum · 1 decimals · custom text #8A2B2B");
	});
	it("names °F and the graph a one-reading key draws, the panel's rule for the stored mode", () => {
		assert.equal(model.displaySummary("key", { fahrenheit: true, displayMode: "bar" }, {}, null), "Current value · auto decimals · shared text · °F · bar");
		// The legacy sparkline flag counts when no valid mode is stored.
		assert.equal(model.displaySummary("key", { sparkline: true, displayMode: "junk" }, {}, null), "Current value · auto decimals · shared text · sparkline");
		// Several readings draw no graph strip, whatever is stored.
		assert.equal(model.displaySummary("key", { keyLayout: "dual", displayMode: "ring" }, {}, null), "Current value · auto decimals · shared text");
		assert.equal(model.displaySummary("key", { displayMode: "ring" }, {}, { effective: { layout: { chosen: "quad", drawn: "quad" } } }), "Current value · auto decimals · shared text");
	});
	it("reports what is drawn when Custom has no valid color", () => {
		const text = model.displaySummary("key", { textMode: "custom", textColor: "red" }, {}, { effective: effective({ text: { mode: "custom", applied: "theme", own: true, color: null, dimSecondary: false } }) });
		assert.match(text, /theme text$/);
	});
	it("names the dial view instead of a stat", () => {
		assert.match(model.displaySummary("dial", { dialView: "tworow" }, {}, null), /^Overview, two rows · auto decimals/);
	});
	it("names a dial's background look for the exact stored values only, as the plugin reads them", () => {
		for (const look of ["glass", "tint", "outline", "clear"]) {
			assert.equal(model.displaySummary("dial", { dialBackground: look }, {}, null), `One reading · auto decimals · shared text · ${look}`);
			assert.equal(model.displaySummary("key", { dialBackground: look }, {}, null), "Current value · auto decimals · shared text");
		}
		for (const raw of [undefined, "theme", "", "Glass", "glass ", "Tint", " tint", " outline", "CLEAR", "transparent", "glow", "shadow", "frost", true, 1, null, {}, ["clear"]]) {
			assert.equal(model.displaySummary("dial", { dialBackground: raw }, {}, null), "One reading · auto decimals · shared text", JSON.stringify(raw));
		}
		assert.equal(model.displaySummary("dial", { dialView: "overview", fahrenheit: true, dialBackground: "outline" }, {}, null), "Overview, three rows · auto decimals · shared text · °F · outline");
	});
	it("leaves accent words out of the summary where a Custom text color makes the box draw nothing", () => {
		const on = { dialBackground: "tint", dialAccentWords: true };
		assert.doesNotMatch(model.displaySummary("dial", { ...on, textMode: "custom", textColor: "#123456" }, {}, null), /accent words/, "the dial's own Custom color");
		assert.doesNotMatch(model.displaySummary("dial", on, { textMode: "custom", textColor: "#123456" }, null), /accent words/, "the shared Custom color");
		assert.doesNotMatch(model.displaySummary("dial", on, {}, { effective: { text: { applied: "custom", color: "#123456", own: false } } } as never), /accent words/, "the plugin's own answer");
		assert.match(model.displaySummary("dial", { ...on, textMode: "custom", textColor: "blue" }, {}, null), /accent words/, "an invalid Custom color draws theme text");
		assert.match(model.displaySummary("dial", { ...on, textMode: "dim" }, { textMode: "custom", textColor: "#123456" }, null), /accent words/, "the dial's own Dimmed wins over the shared Custom");
	});
	it("says accent words only for the exact true on a look that draws them, as the plugin reads it", () => {
		for (const look of ["glass", "tint", "outline"]) {
			assert.equal(model.accentWordsLook({ dialBackground: look }), true, look);
			assert.equal(model.displaySummary("dial", { dialBackground: look, dialAccentWords: true }, {}, null), `One reading · auto decimals · shared text · ${look} · accent words`);
			assert.equal(model.displaySummary("key", { dialBackground: look, dialAccentWords: true }, {}, null), "Current value · auto decimals · shared text");
			for (const raw of [undefined, false, "true", 1, "on", null, {}, [true]]) {
				assert.equal(model.dialAccentWords({ dialBackground: look, dialAccentWords: raw }), false, `${look} ${JSON.stringify(raw)}`);
				assert.equal(model.displaySummary("dial", { dialBackground: look, dialAccentWords: raw }, {}, null), `One reading · auto decimals · shared text · ${look}`, `${look} ${JSON.stringify(raw)}`);
			}
		}
		// Theme and Clear draw their words as before, whatever is stored.
		for (const look of [undefined, "theme", "clear", "Outline", "glass "]) {
			assert.equal(model.accentWordsLook({ dialBackground: look }), false, JSON.stringify(look));
			assert.equal(model.dialAccentWords({ dialBackground: look, dialAccentWords: true }), false, JSON.stringify(look));
			assert.doesNotMatch(model.displaySummary("dial", { dialBackground: look, dialAccentWords: true }, {}, null), /accent words/, JSON.stringify(look));
		}
	});
	it("names a key's background look and its accent words for the exact stored values only, as the plugin reads them", () => {
		for (const look of ["glass", "tint", "outline", "clear"]) {
			assert.equal(model.keyBackground({ keyBackground: look }), look);
			assert.equal(model.displaySummary("key", { keyBackground: look }, {}, null), `Current value · auto decimals · shared text · ${look}`);
			assert.equal(model.displaySummary("dial", { keyBackground: look }, {}, null), "One reading · auto decimals · shared text", "a dial reads its own field");
		}
		for (const raw of [undefined, "theme", "", "Glass", "glass ", " outline", "CLEAR", "frost", true, 1, null, {}, ["clear"]]) {
			assert.equal(model.keyBackground({ keyBackground: raw }), "theme", JSON.stringify(raw));
			assert.equal(model.displaySummary("key", { keyBackground: raw }, {}, null), "Current value · auto decimals · shared text", JSON.stringify(raw));
		}
		for (const look of ["glass", "tint", "outline"]) {
			assert.equal(model.displaySummary("key", { keyBackground: look, keyAccentWords: true }, {}, null), `Current value · auto decimals · shared text · ${look} · accent words`);
			assert.doesNotMatch(model.displaySummary("key", { keyBackground: look, keyAccentWords: true, textMode: "custom", textColor: "#123456" }, {}, null), /accent words/, `${look}: Custom stays exact`);
			for (const raw of [false, "true", 1, null]) assert.equal(model.keyAccentWords({ keyBackground: look, keyAccentWords: raw }), false, `${look} ${JSON.stringify(raw)}`);
		}
		for (const look of [undefined, "theme", "clear", "Glass"]) assert.equal(model.keyAccentWords({ keyBackground: look, keyAccentWords: true }), false, JSON.stringify(look));
	});
	it("says only what is stored when the plugin has not answered", () => {
		assert.equal(model.displaySummary("key", { theme: "paper" }, {}, null), "Current value · auto decimals · shared text");
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
	it("names a single bad field next to a working one", () => {
		const crit = model.alertsSummary("key", { warnValue: "8O", critValue: "90" }, { effective: effective({ alert: { level: "normal", warn: null, crit: 90, below: false, unit: "°C", applies: true, scopeUnit: null } }) });
		assert.equal(crit, "Critical ≥ 90 °C · warn value is not a number");
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
	it("does not promise details the runtime will not open", () => {
		assert.equal(model.keyInteractionSummary({ pressBehavior: "open-details" }, false), "Press would open details, but this deck has none");
		assert.equal(model.keyInteractionSummary({ pressBehavior: "open-details", detailMode: "filter", detailFilter: "  " }, true), "Press opens nothing until the filter is set");
		// Issue #35: separators and spaces alone are an empty pattern, which
		// the runtime refuses; a union names its pattern as typed.
		assert.equal(model.keyInteractionSummary({ pressBehavior: "open-details", detailMode: "filter", detailFilter: " | | " }, true), "Press opens nothing until the filter is set");
		assert.equal(model.keyInteractionSummary({ pressBehavior: "tap-cycle-hold-details", detailMode: "filter", detailFilter: "||" }, true), "Tap cycles; hold opens nothing until the filter is set");
		assert.equal(model.keyInteractionSummary({ pressBehavior: "open-details", detailMode: "filter", detailFilter: " 4090 | ccd2 " }, true), 'Press opens details: filter "4090 | ccd2"');
		assert.equal(model.keyInteractionSummary({ pressBehavior: "open-details" }, null), "Press opens details: this reading's sensor"); // round 3, R32: "sensor" is HWiNFO's group, "source" the data provider
	});
	it("reads the dial's resolved scheme and names a dead tap", () => {
		const controls = { preset: "custom", rotate: "step", pressedRotate: "step", shortPress: "pin", longPress: "resetStats", tap: "cycleStat", touchHold: "backToCurrent", touchZones: "two", switchesGroups: false };
		assert.equal(model.dialInteractionSummary({ autoCycleMs: "30000" }, { effective: { controls } }), "Custom: turn cycles readings · push pins or unpins the reading · touch sides switch readings · auto cycle 30 s");
		assert.equal(model.dialInteractionSummary({ rotationDisabled: true }, null), "Legacy controls · turns ignored");
	});
	it("names three touch zones and a pause with nothing to pause", () => {
		const controls = { preset: "elite", rotate: "step", pressedRotate: "stepGroup", shortPress: "pauseResume", longPress: "resetStats", tap: "cycleStat", touchHold: "backToCurrent", touchZones: "three", switchesGroups: true };
		// Round 3, R30: Elite's pressed turn is named (it differs from a plain
		// turn), resolved to what it does on this dial: no groups in effect,
		// so it switches sensor.
		assert.equal(model.dialInteractionSummary({}, { effective: { controls } }), "Elite: turn cycles readings · pressed turn switches sensor · push pauses or resumes the auto cycle (auto cycle is off) · touch sides switch readings, center tap cycles the stat");
		assert.equal(model.dialInteractionSummary({ autoCycleMs: "90000" }, { effective: { controls } }), "Elite: turn cycles readings · pressed turn switches sensor · push pauses or resumes the auto cycle · touch sides switch readings, center tap cycles the stat · auto cycle 90 s");
	});
	it("names a reset that reaches past this reading on whichever push does it (round 3, re-review PY03)", () => {
		const legacy = { preset: "legacy", rotate: "step", pressedRotate: "step", shortPress: "resetStats", longPress: "resetStats", tap: "cycleStat", touchHold: "none", touchZones: "off", switchesGroups: false };
		assert.equal(model.dialInteractionSummary({ resetScope: "all" }, { effective: { controls: legacy } }), "Legacy: turn cycles readings · push resets session stats (every dial, everywhere) · tap cycles the stat");
		assert.equal(model.dialInteractionSummary({}, { effective: { controls: legacy } }), "Legacy: turn cycles readings · push resets session stats · tap cycles the stat");
		const elite = { preset: "elite", rotate: "step", pressedRotate: "stepGroup", shortPress: "pauseResume", longPress: "resetStats", tap: "cycleStat", touchHold: "backToCurrent", touchZones: "off", switchesGroups: true };
		assert.equal(model.dialInteractionSummary({ resetScope: "set" }, { effective: { controls: elite } }), "Elite: turn cycles readings · pressed turn switches sensor · push pauses or resumes the auto cycle · long push resets session stats (whole rotation set) · tap cycles the stat");
		assert.doesNotMatch(model.dialInteractionSummary({}, { effective: { controls: elite } }), /long push/);
	});
	it("resolves Switch sensor or group by the groups in effect, and leaves out a pressed turn that matches the turn", () => {
		const controls = { preset: "elite", rotate: "step", pressedRotate: "stepGroup", shortPress: "pin", longPress: "resetStats", tap: "cycleStat", touchHold: "backToCurrent", touchZones: "off", switchesGroups: true };
		const two = [{ name: "A", keys: ["a"] }, { name: "B", keys: ["b"] }];
		assert.match(model.dialInteractionSummary({ rotationGroups: two }, { effective: { controls } }), / · pressed turn switches group · /);
		// One group holding readings (the other empty, or only repeating a
		// claimed key) is not in effect: the runtime switches sensor.
		assert.match(model.dialInteractionSummary({ rotationGroups: [{ name: "A", keys: ["a"] }, { name: "B", keys: [] }] }, { effective: { controls } }), / · pressed turn switches sensor · /);
		assert.match(model.dialInteractionSummary({ rotationGroups: [{ name: "A", keys: ["a"] }, { name: "B", keys: ["a"] }] }, { effective: { controls } }), / · pressed turn switches sensor · /);
		assert.doesNotMatch(model.dialInteractionSummary({}, { effective: { controls: { ...controls, pressedRotate: "step" } } }), /pressed turn/);
		assert.doesNotMatch(model.dialInteractionSummary({ rotationDisabled: true }, { effective: { controls } }), /pressed turn/);
		assert.equal(model.groupsActive({ rotationGroups: two }), true);
		assert.equal(model.groupsActive({ rotationGroups: "junk" }), false);
	});
	it("claims rotation groups by the runtime's rule (rotationGroupsOf), malformed settings included", () => {
		// Two leading groups of keys nothing else uses keep the runtime's
		// two-group floor out of the way, so every group after them is
		// compared, one group or none included.
		const lead = [{ name: "lead 1", keys: ["lead:1"] }, { name: "lead 2", keys: ["lead:2"] }];
		const corpus: unknown[] = [
			undefined,
			null,
			"junk",
			7,
			{},
			{ keys: ["a"] },
			[],
			[null, 1, "a", true, ["a"], { keys: "a" }, { name: "no keys" }, { keys: null }],
			[{ keys: [] }, { keys: ["", "  ", "\t"] }, { keys: [1, null, {}, ["a"], true] }],
			[{ keys: ["a", "a", " a", "a "] }],
			[{ name: "A", keys: ["a", "b"] }, { name: "B", keys: ["b", "c"] }, { name: "C", keys: ["a", "b"] }],
			[{ name: "A", keys: ["a"] }, { name: "B", keys: ["a"] }],
			[{ name: "A", keys: ["a"] }, { name: "B", keys: ["a"] }, { name: "C", keys: ["c"] }],
			[{ name: 5, keys: ["a"] }, Object.assign(Object.create(null), { keys: ["b"] }), { keys: ["c"], extra: { keys: ["d"] } }],
			[{ keys: ["lead:1", "x"] }, { keys: ["y"] }]
		];
		for (const raw of corpus) {
			const label = JSON.stringify(raw) ?? String(raw);
			const runtime = rotationGroupsOf(raw);
			assert.equal(model.groupsActive({ rotationGroups: raw }), runtime !== undefined, label);
			if (runtime !== undefined) assert.deepEqual(model.claimedGroups({ rotationGroups: raw }), runtime.map((g) => g.keys), label);
			if (!Array.isArray(raw)) {
				assert.deepEqual(model.claimedGroups({ rotationGroups: raw }), [], label);
				continue;
			}
			const led = [...lead, ...raw];
			assert.deepEqual(model.claimedGroups({ rotationGroups: led }), rotationGroupsOf(led)?.map((g) => g.keys), label);
		}
		assert.deepEqual(model.claimedGroups({}), []);
	});
	it("follows the Control action's rules for command and target", () => {
		assert.deepEqual(model.controlSummary({}), { command: "Next reading", target: "every dial" });
		assert.deepEqual(model.controlSummary({ command: "resetStats", resetScope: "all", target: "x" }), { command: "Reset session stats", target: "every dial on every Stream Deck (Link ID ignored)" });
		assert.deepEqual(model.controlSummary({ command: "resetStats", target: " cpu " }), { command: "Reset session stats, current reading", target: 'dials with Link ID "cpu"' });
		assert.match(model.controlSummary({ command: "warp" }).command, /^Unknown command/);
		// Strip commands reach strips by the strip's own Link ID.
		assert.deepEqual(model.controlSummary({ command: "stripToggleInspect" }), { command: "Strip: inspect or back to live", target: "every strip" });
		assert.deepEqual(model.controlSummary({ command: "stripWindowNext", target: " desk ", resetScope: "all" }), { command: "Strip: longer time window", target: 'strips with Link ID "desk"' });
		// A stored object is named as JSON, never coerced: some objects have
		// no string form and threw mid-render (external review AX59).
		for (const command of [{ toString: null }, { toString: 0, valueOf: 0 }, [1], null, 17]) {
			assert.deepEqual(model.controlSummary({ command } as Settings), { command: `Unknown command "${JSON.stringify(command)}": the key shows an alert`, target: "" });
		}
	});
	it("summarizes the shared connection choices", () => {
		// "read every", the words of the control it summarizes (Read every).
		assert.equal(model.advancedSummary({}), "Auto source · read every 1 s · decimal units");
		assert.equal(model.advancedSummary({ source: "gadget", pollIntervalMs: "250", dataUnits: "binary" }), "Gadget only · read every 250 ms · binary units");
		// The interval reads as the runtime parses it (parsePollInterval), not
		// only as the menu offers it.
		for (const [raw, shown] of [["2000", "read every 2 s"], [5000, "read every 5 s"], [1500, "read every 1.5 s"], ["100", "read every 250 ms"], [90_000, "read every 60 s"], ["", "read every 250 ms"], ["fast", "read every 1 s"], [null, "read every 1 s"]] as const) {
			assert.equal(model.advancedSummary({ pollIntervalMs: raw } as Settings), `Auto source · ${shown} · decimal units`, String(raw));
			assert.equal(`read every ${((ms) => (ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`))(parsePollInterval(raw))}`, shown, `runtime agrees for ${String(raw)}`);
		}
	});
	it("summarizes the folded Advanced groups with the runtime's defaults and parse", () => {
		// Shared defaults: absent fields read as the runtime's defaults
		// (Void, theme text, accents by sensor type, decimal units).
		assert.equal(model.sharedDefaultsSummary({}), "Void · theme text · Tahoma · accents by type · decimal units");
		assert.equal(model.sharedDefaultsSummary({ theme: "paper", textMode: "dim", typeAccents: "off", dataUnits: "binary", textFont: "segoe-ui" }), "Paper · dimmed text · Segoe UI · theme accent · binary units");
		// A stored id this version does not know draws the spec default.
		assert.equal(model.sharedDefaultsSummary({ theme: "neon" }).split(" · ")[0], "Void");
		// With no shared theme stored, the plugin's resolved answer (legacy
		// migration included) is what Default draws, so the summary names it.
		assert.equal(model.sharedDefaultsSummary({}, "ember").split(" · ")[0], "Ember");
		assert.equal(model.sharedDefaultsSummary({ theme: "paper" }, "paper").split(" · ")[0], "Paper");
		assert.equal(model.sharedDefaultsSummary({}, "not-a-theme").split(" · ")[0], "Void");
		// A stored object is no theme, and never coerced (AX59).
		for (const theme of [{ toString: null }, { toString: 0, valueOf: 0 }, ["paper"]]) {
			assert.equal(model.sharedDefaultsSummary({ theme } as Settings).split(" · ")[0], "Void", JSON.stringify(theme));
		}
		// Connection: the interval as parsePollInterval reads it.
		assert.equal(model.connectionSummary({}), "Auto source · read every 1 s");
		assert.equal(model.connectionSummary({ source: "shared-memory", pollIntervalMs: "250" }), "Shared Memory only · read every 250 ms");
		assert.equal(model.connectionSummary({ source: "gadget", pollIntervalMs: 90_000 }), `Gadget only · read every ${parsePollInterval(90_000) / 1000} s`);
	});
});

describe("lossless write helpers", () => {
	it("keeps list entries this build does not edit, and where they were", () => {
		const raw = ["a", 7, "", "b", { future: 1 }, "c"];
		const split = model.splitKeyList(raw, 2);
		assert.deepEqual(split, { known: ["a", "b"], kept: [7, "", { future: 1 }, "c"], keptAt: [1, 2, 4, 5] });
		assert.deepEqual(model.mergeKept(split.known, split.kept, split.keptAt), raw, "an untouched list comes back exactly as stored");
		assert.deepEqual(model.mergeKept(["b", "a"], split.kept, split.keptAt), ["b", 7, "", "a", { future: 1 }, "c"], "a reorder moves only the edited entries");
		assert.deepEqual(model.mergeKept([], split.kept, split.keptAt), [7, "", { future: 1 }, "c"], "indices clamp to the list's end");
		assert.deepEqual(model.splitKeyList("junk"), { known: [], kept: [], keptAt: [] });
	});
	it("rewrites only the fields an edit changed", () => {
		const raw = { name: "CPU", keys: ["a"], futureGroupField: { deep: [1] } };
		const base = { name: "CPU", keys: ["a"] };
		assert.deepEqual(model.patchEntry(raw, base, { name: "CPU", keys: ["a", "b"] }, ["name", "keys"]), { name: "CPU", keys: ["a", "b"], futureGroupField: { deep: [1] } });
		const junk = { size: 4, labels: "ABCD", extra: true };
		assert.deepEqual(model.patchEntry(junk, { size: 4, labels: ["", "", "", ""] }, { size: 4, labels: ["", "", "", ""] }, ["size", "labels"]), junk);
		assert.deepEqual(model.patchEntry(null, null, { size: 1 }, ["size"]), { size: 1 });
	});
	it("leaves an entry it cannot read exactly as stored until an edit changes its meaning", () => {
		const base = { size: 1, labels: [""], colors: [null], cellLabels: true };
		assert.equal(model.patchEntry(3, base, { ...base }, ["size", "labels", "colors", "cellLabels"]), 3);
		assert.equal(model.patchEntry(null, base, { ...base }, ["size", "labels", "colors", "cellLabels"]), null);
		assert.deepEqual(model.patchEntry(3, base, { ...base, size: 2 }, ["size"]), { size: 2 });
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

describe("theme names", () => {
	it("names this build's own themes and never an inherited JavaScript member", () => {
		// A stored "constructor" used to name Object's native function in a
		// spoken line (external review AX15).
		assert.equal(model.themeName("ember"), "Ember");
		assert.equal(model.themeName("constructor"), "Constructor");
		assert.equal(model.themeName("toString"), "ToString");
		assert.equal(model.themeName("__proto__"), "__proto__");
		assert.equal(model.themeName("future-theme"), "Future-theme");
		assert.equal(model.themeName(""), "");
		assert.equal(model.themeName(undefined), "");
	});
});

describe("stored names are this build's own", () => {
	// external review AX22 and AX23.
	const inherited = ["constructor", "__proto__", "toString", "hasOwnProperty"];
	it("a Control command named like a JavaScript member is unknown", () => {
		for (const id of inherited) {
			assert.deepEqual(model.controlSummary({ command: id }), { command: `Unknown command "${id}": the key shows an alert`, target: "" }, id);
		}
	});
	it("names Back to current value, a command the dial runs", () => {
		assert.deepEqual(model.controlSummary({ command: "backToCurrent" }), { command: "Back to current value", target: "every dial" });
	});
	it("a gesture command named like a JavaScript member does nothing", () => {
		for (const id of inherited) assert.equal(model.gestureWords(id, {}), "does nothing", id);
	});
	it("the detail slot panel names an inherited slot as unrecognized instead of throwing", () => {
		const slotSource = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-slot.js", import.meta.url)), "utf8");
		for (const slot of [...inherited, "back"]) {
			const text: Record<string, string> = {};
			const doc = { getElementById: (id: string) => ({ set textContent(v: string) { text[id] = v; } }) };
			const win: { connectElgatoStreamDeckSocket?: (...args: string[]) => void } = {};
			new Function("window", "document", slotSource)(win, doc);
			win.connectElgatoStreamDeckSocket?.("0", "u", "e", "{}", JSON.stringify({ payload: { settings: { slot } } }));
			assert.equal(text["slot-role"], slot === "back" ? "Back tile" : "Unrecognized detail tile", slot);
		}
	});
	it("the detail slot panel names a reading tile without a reading number the page does not keep", () => {
		// A tile holds one to four readings and the second Back takes a slot,
		// so slot N is not reading N.
		const slotSource = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-slot.js", import.meta.url)), "utf8");
		const text: Record<string, string> = {};
		const doc = { getElementById: (id: string) => ({ set textContent(v: string) { text[id] = v; } }) };
		const win: { connectElgatoStreamDeckSocket?: (...args: string[]) => void } = {};
		new Function("window", "document", slotSource)(win, doc);
		win.connectElgatoStreamDeckSocket?.("0", "u", "e", "{}", JSON.stringify({ payload: { settings: { slot: "reading", index: 3 } } }));
		assert.equal(text["slot-role"], "Reading tile");
		assert.doesNotMatch(text["slot-explain"] ?? "", /\d/);
		assert.match(text["slot-explain"] ?? "", /goes back/);
	});
});

describe("key alerts and the press in the panel model", () => {
	const keyAlerts = (slots: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ dwellMs: 0, hyst: 0, snoozeMs: null, face: { level: "normal", snoozed: null }, slots, ...extra });
	it("names readings with their own limits, the wait and a snooze, and keeps legacy-only lines as they were", () => {
		const legacy = { level: "normal", warn: 80, crit: null, below: false, unit: "°C", applies: true, scopeUnit: null };
		assert.equal(model.alertsSummary("key", {}, { effective: effective({ alert: legacy, keyAlerts: keyAlerts([{ slot: 0, source: "legacy" }]) }) }), "Warn ≥ 80 °C", "the 1.7.1 line");
		const own = keyAlerts([{ slot: 0, source: "legacy" }, { slot: 1, source: "reading" }], { dwellMs: 5000, face: { level: "normal", snoozed: "warn" } });
		assert.equal(model.alertsSummary("key", {}, { effective: effective({ layout: { chosen: "dual", drawn: "dual" }, alert: legacy, keyAlerts: own }) }), "Warn ≥ 80 °C · first reading · own limits on 1 reading · after 5 s · snoozed");
		const onlyOwn = keyAlerts([{ slot: 1, source: "reading" }, { slot: 2, source: "reading" }]);
		assert.equal(model.alertsSummary("key", {}, { effective: effective({ alert: { ...legacy, warn: null, level: "crit" }, keyAlerts: onlyOwn }) }), "Own limits on 2 readings · critical now");
		assert.equal(model.alertsSummary("dial", {}, { effective: effective({ alert: { ...legacy, warn: null }, keyAlerts: onlyOwn }) }), "Off", "a dial line never reads key fields");
	});
	it("reads the Timing fields exactly as the plugin parses them", () => {
		assert.equal(model.keyAlertTimingSummary({}), "Immediately");
		assert.equal(model.keyAlertTimingSummary({ alertDwellMs: "10000", alertHysteresis: "2,5", alertSnoozeMs: "3600000" }), "After 10 s · clears 2.5 back · a press snoozes 1 hour");
		assert.equal(model.keyAlertTimingSummary({ alertDwellMs: "7000", alertHysteresis: "-3", alertSnoozeMs: "60000" }), "Immediately", "junk is what the plugin ignores");
		assert.equal(model.keyAlertTimingSummary({ alertSnoozeMs: "constructor" }), "Immediately");
	});
	it("one row's edit writes its entry with the captured unit and keeps everything else", () => {
		const raw = { other: { warn: "1", future: true }, cpu: { warn: "70", hyst: "2", note: "kept" } };
		const next = model.patchKeyAlertRule(raw, "cpu", { warn: "75", crit: "90", below: false, hyst: "" }, "°C");
		assert.deepEqual(next, { other: { warn: "1", future: true }, cpu: { warn: "75", note: "kept", crit: "90", unit: "°C" } });
		assert.deepEqual(model.patchKeyAlertRule({ cpu: { warn: "70", unit: "°C" } }, "cpu", { warn: "", crit: "", below: false, hyst: "" }, "°C"), {}, "an emptied row leaves no entry");
		assert.deepEqual(model.patchKeyAlertRule({ cpu: { warn: "70", unit: "°C" } }, "cpu", { warn: "71" }), { cpu: { warn: "71", unit: "°C" } }, "no unit reported: the captured one stays");
		const proto = model.patchKeyAlertRule(JSON.parse('{"__proto__":{"warn":"1"}}'), "__proto__", { warn: "2" }, "V");
		assert.ok(Object.hasOwn(proto, "__proto__"));
		assert.equal(JSON.stringify(proto), '{"__proto__":{"warn":"2","unit":"V"}}');
		assert.deepEqual(model.patchKeyAlertRule("junk", "a", { below: true }, ""), {}, "a lone direction is no entry");
		assert.deepEqual(model.patchKeyAlertRule("junk", "a", { warn: "1" }, ""), { a: { warn: "1", unit: "" } }, "a unitless capture is a unit");
	});
	it("a press this build does not have reads as the default press, as the plugin reads it", () => {
		for (const b of ["open-workspace", "launch", "tap-cycle-hold-launch", "tap-launch-hold-details", "junk"]) {
			assert.equal(model.pressBehavior({ pressBehavior: b }), "cycle-stat", b);
			assert.equal(model.keyInteractionSummary({ pressBehavior: b, launch: { kind: "url", url: "https://example.com/x" } }), "Press cycles current, min, max, avg", b);
		}
		assert.equal(model.detailsBehavior("tap-launch-hold-details"), false);
		assert.equal(model.keyInteractionSummary({ detailRole: "back", pressBehavior: "launch" }), "Press returns to the previous profile (Back tile)");
	});
});

describe("per-reading formats: the panel's write helper (issue #59)", () => {
	const same = (a: string, b: string): boolean => a === b;

	it("files one entry under the row key and keeps every other entry as stored", () => {
		const raw = { other: { unit: "TB", future: 1 }, junk: "x" };
		const { next } = model.patchReadingFormat(raw, ["g:a"], "g:a", { unit: "GB" });
		assert.deepEqual(next, { other: { unit: "TB", future: 1 }, junk: "x", "g:a": { unit: "GB" } });
		assert.deepEqual(raw, { other: { unit: "TB", future: 1 }, junk: "x" }, "the stored map is not mutated");
	});

	it("clears the reading's entries under every key it has, keeping the winner's unknown fields", () => {
		const raw = { alias: { unit: "GB", decimals: "1", note: "kept" }, saved: { decimals: "3" }, other: { unit: "MB" } };
		const { next } = model.patchReadingFormat(raw, ["row", "saved", "alias"], "row", { decimals: "2" });
		assert.deepEqual(next, { other: { unit: "MB" }, row: { decimals: "2" } }, "the saved key's entry wins the walk and moves to the row key");
		const viaAlias = model.patchReadingFormat({ alias: { unit: "GB", note: "kept" } }, ["row", "alias"], "row", { decimals: "2" });
		assert.deepEqual(viaAlias.next, { row: { unit: "GB", note: "kept", decimals: "2" } });
	});

	it("an empty choice removes the field, the entry and finally the whole map", () => {
		assert.deepEqual(model.patchReadingFormat({ r: { unit: "GB", decimals: "2" } }, ["r"], "r", { unit: "" }).next, { r: { decimals: "2" } });
		assert.equal(model.patchReadingFormat({ r: { decimals: "2" } }, ["r"], "r", { decimals: "" }).next, undefined);
		assert.deepEqual(model.patchReadingFormat({ r: { decimals: "2", future: true } }, ["r"], "r", { decimals: "" }).next, { r: { future: true } }, "an unknown field keeps the entry");
		assert.equal(model.patchReadingFormat(undefined, ["r"], "r", { unit: "" }).next, undefined);
	});

	it("a __proto__ or constructor key stays an own entry; the prototype is untouched", () => {
		const { next } = model.patchReadingFormat({}, ["__proto__"], "__proto__", { unit: "GB" });
		assert.ok(next !== undefined && Object.hasOwn(next, "__proto__"));
		assert.equal(Object.getPrototypeOf(next), Object.prototype);
		assert.equal(JSON.stringify(next), '{"__proto__":{"unit":"GB"}}');
		const ctor = model.patchReadingFormat(JSON.parse('{"__proto__": {"unit": "TB"}}'), ["constructor"], "constructor", { decimals: "1" });
		assert.ok(ctor.next !== undefined && Object.hasOwn(ctor.next, "constructor") && Object.hasOwn(ctor.next, "__proto__"));
		assert.equal(({} as Record<string, unknown>).unit, undefined);
	});

	it("never replaces a map this build cannot read", () => {
		for (const raw of [[], [{ unit: "GB" }], "GB", 5, true]) assert.deepEqual(model.patchReadingFormat(raw, ["r"], "r", { unit: "GB" }), { refused: "shape" }, JSON.stringify(raw));
	});

	it("adds no new entry past the cap, but edits an existing one", () => {
		const full: Record<string, unknown> = {};
		for (let i = 0; i < model.READING_FORMATS_CAP; i++) full[`k${i}`] = { unit: "GB" };
		assert.equal(model.READING_FORMATS_CAP, 128);
		assert.deepEqual(model.patchReadingFormat(full, ["new"], "new", { unit: "GB" }), { refused: "cap" });
		assert.ok(model.patchReadingFormat(full, ["k5"], "k5", { decimals: "1" }).next !== undefined);
		assert.ok(model.patchReadingFormat(full, ["new"], "new", { unit: "" }).next !== undefined, "a choice that adds nothing is no new entry");
	});

	it("one decimals list, the runtime's: every choice it lists is read, nothing else is", () => {
		const reading = { key: "r", unit: "°C" };
		const base = { decimals: "1" as const, fahrenheit: false, dataUnits: "decimal" as const };
		assert.deepEqual([...model.FORMAT_DECIMALS], ["auto", "0", "1", "2", "3"]);
		assert.ok(Object.isFrozen(model.FORMAT_DECIMALS));
		for (const d of model.FORMAT_DECIMALS) assert.equal(measureFor(base, { r: { decimals: d } }, reading).decimals, d, d);
		for (const d of ["4", "-1", "Auto", "", "1.0"]) assert.equal(measureFor(base, { r: { decimals: d } }, reading), base, d);
		const loose = model as unknown as Record<string, unknown>;
		assert.equal(loose.formatChoice, undefined, "the unused choice helper is gone");
		assert.equal(loose.formatDecimalsValid, undefined, "the unused validity helper is gone");
		const common = readFileSync(fileURLToPath(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-common.js", import.meta.url)), "utf8");
		assert.ok(!common.includes('"auto", "0", "1", "2", "3"'), "pi-common.js repeats no decimals list");
		assert.ok(common.includes("model.FORMAT_DECIMALS"));
	});

	it("a no-op patch keeps the document equal", () => {
		const raw = { r: { unit: "GB" } };
		assert.equal(model.sortedJson(model.patchReadingFormat(raw, ["r"], "r", { unit: "GB" }).next), model.sortedJson(raw));
	});

	it("the walk finds the first own object entry", () => {
		assert.deepEqual(model.readingFormatOf({ a: "junk", b: { unit: "GB" } }, ["a", "b"]), { key: "b", entry: { unit: "GB" } });
		assert.equal(model.readingFormatOf([], ["a"]), null);
		assert.equal(model.readingFormatOf({}, ["toString"]), null);
	});

	it("rows follow the stored layout's slots; a repeated reading gets a row with no controls", () => {
		assert.deepEqual(model.formatRowPlan({ readingKey: "a" }, same), [{ slot: 0, key: "a", kind: "edit" }]);
		assert.deepEqual(model.formatRowPlan({ readingKey: "a", secondaryReadingKey: "b" }, same), [{ slot: 0, key: "a", kind: "edit" }], "dual needs its marker");
		assert.deepEqual(model.formatRowPlan({ readingKey: "a", secondaryReadingKey: "b", quadReadingKey3: "a", quadReadingKey4: "", keyLayout: "quad" }, same), [
			{ slot: 0, key: "a", kind: "edit" },
			{ slot: 1, key: "b", kind: "edit" },
			{ slot: 2, key: "a", kind: "same", of: 0 }
		]);
		assert.deepEqual(model.formatRowPlan({}, same), []);
	});

	it("the folded line says what is set", () => {
		assert.equal(model.formatsSummary([{ name: "Reading 1", unit: "", decimals: "" }]), "None set");
		assert.equal(model.formatsSummary([]), "None set");
		assert.equal(model.formatsSummary([{ name: "Reading 1", unit: "GB", decimals: "2" }]), "Reading 1: GB, 2 decimals");
		assert.equal(model.formatsSummary([{ name: "Reading 2", unit: "", decimals: "1" }]), "Reading 2: 1 decimal");
		assert.equal(model.formatsSummary([{ name: "A", unit: "", decimals: "auto" }]), "A: auto decimals");
		assert.equal(model.formatsSummary([{ name: "A", unit: "GB", decimals: "" }, { name: "B", unit: "", decimals: "0" }]), "2 readings set");
	});
});

describe("Advanced, Shared defaults: the count line and Use it everywhere", () => {
	it("names who keeps their own choice, and what", () => {
		assert.equal(model.ownLooksLine({ keys: 0, dials: 4, strips: 1, background: 5, words: 1 }), "4 dials and 1 strip use their own background.");
		assert.equal(model.ownLooksLine({ keys: 0, dials: 0, strips: 1, background: 1, words: 1 }), "1 strip uses its own background.");
		assert.equal(model.ownLooksLine({ keys: 2, dials: 1, strips: 3, background: 6, words: 0 }), "2 keys, 1 dial and 3 strips use their own background.");
		assert.equal(model.ownLooksLine({ keys: 1, dials: 0, strips: 0, background: 0, words: 1 }), "1 key uses its own word color.");
		assert.equal(model.ownLooksLine({ keys: 3, dials: 0, strips: 0, background: 0, words: 3 }), "3 keys use their own word color.");
		assert.equal(model.ownLooksLine({ keys: 2, dials: 0, strips: 0, background: 1, words: 1 }), "2 keys use their own background or word color.");
	});

	it("says nothing when none keeps its own choice, or the count is junk", () => {
		for (const junk of [null, undefined, {}, { keys: 0, dials: 0, strips: 0 }, { keys: -1, dials: "3", strips: 1.5 }]) assert.equal(model.ownLooksLine(junk), "", JSON.stringify(junk));
	});

	it("a pasted document's own looks carry this machine's generation exactly; nothing else changes", () => {
		assert.deepEqual(model.stampOwnLooks({ dialBackground: "clear", label: "x" }, "dial", 2), { dialBackground: "clear", label: "x", looksGen: 2 });
		assert.deepEqual(model.stampOwnLooks({ keyAccentWords: false }, "key", 2), { keyAccentWords: false, looksGen: 2 });
		assert.deepEqual(model.stampOwnLooks({ dialBackground: "clear" }, "dial", undefined), { dialBackground: "clear" }, "no reset made");
		assert.deepEqual(model.stampOwnLooks({ dialBackground: "" }, "dial", 2), { dialBackground: "" }, "Default holds nothing");
		assert.deepEqual(model.stampOwnLooks({ keyBackground: "glass", looksGen: 4 }, "key", 2), { keyBackground: "glass", looksGen: 2 }, "another machine's later stamp comes down to this one's");
		assert.deepEqual(model.stampOwnLooks({ keyBackground: "glass", looksGen: 4 }, "key", undefined), { keyBackground: "glass" }, "no reset made here: no stamp");
		assert.deepEqual(model.stampOwnLooks({ label: "x", looksGen: 4 }, "dial", 2), { label: "x", looksGen: 2 });
		assert.deepEqual(model.stampOwnLooks({ label: "x", looksGen: 1 }, "dial", 2), { label: "x", looksGen: 1 });
		assert.equal(model.looksGenOf("2"), 0);
	});

	it("looksResetGen is this machine's: a pasted shared document never carries another's", () => {
		assert.equal(Object.hasOwn(model.sharedDocForWell({ theme: "ember", looksResetGen: 3 }), "looksResetGen"), false);
		const written = model.sharedDocToWrite({ theme: "paper", dialBackground: "nebula", looksResetGen: 9 }, { theme: "ember", looksResetGen: 2 });
		assert.equal(written.looksResetGen, 2);
		assert.equal(written.dialBackground, "nebula");
	});
});

describe("the art looks' Stars and Sky color in the panel", () => {
	it("the panel's look and Sky names are the plugin's, three amounts and five tones, and Milky Way and Moonrise are not looks", () => {
		assert.deepEqual(model.ART_LOOKS, [...ART_LOOKS]);
		assert.deepEqual(model.STARS, [...ART_STARS]);
		assert.deepEqual(model.TONES, [...ART_TONES]);
		for (const look of ["milkyway", "moonrise", "aurora"]) {
			assert.equal(model.isArtLook(look), false, look);
			assert.equal(model.lookOf(look), null, `${look} is a name this build does not know`);
		}
	});

	it("the Stars look keeps at least Few, as the plugin draws it; Default names the amount drawn", () => {
		for (const look of ["theme", ...ART_LOOKS]) for (const stars of ART_STARS) if (look !== "theme") assert.equal(model.drawnStars(look, stars), drawnStars(look as (typeof ART_LOOKS)[number], stars), `${look} ${stars}`);
		assert.equal(model.drawnStars("stars", "off"), "few");
		assert.equal(model.drawnStars("dusk", "off"), "off");
		assert.equal(model.drawnStars("stars", "some"), "some", "a value this build does not know shows as kept");
		assert.deepEqual(model.sharedSkyOf({ keyStars: "off", keySkyColor: "cool", dialStars: "few" }, "key"), { stars: "off", tone: "cool" });
		assert.deepEqual(model.sharedSkyOf({ dialStars: "few" }, "dial"), { stars: "few", tone: "theme" });
		assert.deepEqual(model.sharedSkyOf({ keySky: "deep-few", keyStars: "some", keySkyColor: "Cool" }, "key"), { stars: "all", tone: "theme" }, "a combined Sky and some are not read");
		assert.equal(model.skyShown("some", ""), "some");
		assert.equal(model.skyShown("", "all"), "all");
		assert.equal(model.skyShown(undefined, ""), "");
	});

	it("each name's text is the catalog's: All, Few, Off; Theme, Deep, Warmer, Cooler, Mono", () => {
		const strings = PANEL.pi.keyBackground as Record<string, string>;
		assert.deepEqual(Object.keys(model.STARS_TEXT), [...ART_STARS]);
		assert.deepEqual(Object.keys(model.TONE_TEXT), [...ART_TONES]);
		for (const [key, english] of [...Object.values(model.STARS_TEXT), ...Object.values(model.TONE_TEXT)]) assert.equal(strings[key], english, key);
		assert.deepEqual(Object.values(model.TONE_TEXT).map(([, t]) => t), ["Theme", "Deep", "Warmer", "Cooler", "Mono"]);
		assert.equal(strings.artHelp, undefined, "no standing line on the art looks");
		assert.equal(strings.artPaper, "Paper draws no sky; a dark theme shows it.");
		// No line for the Stars look's Few: the select already shows the Few
		// it draws, and a line that came and went with a Stars pick moved
		// the pair under the pointer by its own height.
		assert.equal(strings.artStarsFloor, undefined, "no line for the Stars look's Few");
		assert.equal(strings.starsSome, undefined);
		assert.equal(strings.skyHelp, undefined, "one help line on the art looks");
	});

	it("every Default option names its value first through one catalog template, and the shared Words takes its whole label", () => {
		const shared = PANEL.pi.sharedLooks as Record<string, string>;
		assert.equal(shared.followsShared, "{value} (shared)");
		assert.equal(shared.wordsLabel, "Words in the accent color");
		assert.equal(shared.words, undefined, "no separate Words heading in Shared defaults");
		assert.equal(shared.inTheAccent, undefined);
		assert.equal((PANEL.pi.keyBackground as Record<string, string>).showsTheStripPicture, "Shows the touch strip picture set in the Stream Deck app.");
	});

	it("a theme is light exactly where the plugin draws no art on it (deck-art.ts artFits), and Paper is the only light theme, as the panel's note says", () => {
		const { themes } = JSON.parse(readFileSync(new URL("../com.lawrensen.hwinfo.sdPlugin/themes.json", import.meta.url), "utf8")) as { themes: Record<string, { bg: string }> };
		for (const [id, theme] of Object.entries(themes)) assert.equal(model.lightTheme(theme.bg), !artFits(theme), id);
		assert.deepEqual(Object.keys(themes).filter((id) => model.lightTheme(themes[id]?.bg)), ["paper"], "the note under Background names Paper");
		// Every gray, so the 0.18 edge is the plugin's to the step.
		for (let v = 0; v < 256; v++) {
			const bg = `#${v.toString(16).padStart(2, "0").repeat(3).toUpperCase()}`;
			assert.equal(model.lightTheme(bg), !artFits({ bg }), bg);
		}
		for (const raw of [undefined, null, "", "paper", "#FFF", "#GGGGGG", 7]) assert.equal(model.lightTheme(raw), false, String(raw));
	});
});

describe("the Stars look's Off in the panel (pi-common.js offerOff)", () => {
	it("on the Stars look Off is hidden and reads as Few, so a stored Off shows as Few and picking Few is still a change that writes it; on Dusk and Nebula it is Off again", () => {
		const source = readFileSync(new URL("../com.lawrensen.hwinfo.sdPlugin/ui/pi-common.js", import.meta.url), "utf8");
		const start = source.indexOf("\t/** A Stars amount's text");
		const end = source.indexOf("\tconst accentWordsEl", start);
		assert.ok(start >= 0 && end > start, "pi-common.js anchors moved");
		const off = { value: "off", hidden: false, disabled: false, textContent: "Off" };
		const select = { querySelector: (q: string) => (q === 'option[value="off"]:not([data-unknown])' ? off : null) };
		const offerOff = new Function("model", "hwT", `${source.slice(start, end)}\nreturn offerOff;`)(model, undefined) as (select: unknown, offer: boolean) => void;
		offerOff(select, false);
		assert.deepEqual({ ...off }, { value: "off", hidden: true, disabled: true, textContent: "Few" });
		offerOff(select, false);
		assert.deepEqual({ ...off }, { value: "off", hidden: true, disabled: true, textContent: "Few" }, "a second render keeps it");
		offerOff(select, true);
		assert.deepEqual({ ...off }, { value: "off", hidden: false, disabled: false, textContent: "Off" });
	});
});
