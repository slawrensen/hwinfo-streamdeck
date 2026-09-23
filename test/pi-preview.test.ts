/**
 * The settings panel's preview payload (src/pi-protocol.ts buildPreview)
 * and the shared key-layout rule. Three boundaries are pinned:
 *
 *  1. fixture semantics decided independently here (thresholds parse the
 *     way the runtime reads them, a stale or unavailable source is never
 *     "missing", Custom without a color draws theme text, an unknown theme
 *     draws the spec default, a dial's thresholds only apply in their unit);
 *  2. the face the panel shows is exactly the string the action sent to the
 *     device: buildPreview carries it verbatim and never renders one;
 *  3. drawnKeyLayout is the gate compose() branches on, so the panel's
 *     layout summary and the key face cannot disagree.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compose } from "../src/actions/sensor-reading";
import { SensorType, type Reading, type SensorSnapshot } from "../src/hwinfo/types";
import { buildPreview } from "../src/pi-protocol";
import type { PollerStatus } from "../src/poller";
import { drawnKeyLayout } from "../src/ui/key-layout";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { loadThemes } from "../src/ui/themes";

function reading(key: string, value: number, unit: string, label: string, type = SensorType.Temperature): Reading {
	return { key, type, sensorIndex: 0, id: 0, label, unit, value, valueMin: value - 5, valueMax: value + 5, valueAvg: value };
}

const readings = [reading("cpu:0:0", 67.4, "°C", "CPU Tctl"), reading("fan:0:0", 0, "RPM", "Pump", SensorType.Fan), reading("off:0:0", -0.025, "V", "Offset", SensorType.Voltage)];
const snapshot: SensorSnapshot = { pollTime: 1, version: 1, revision: 1, sensors: [{ index: 0, id: 0, instance: 0, name: "CPU [#0]" }], readings, byKey: new Map(readings.map((r) => [r.key, r])) };
const ok: PollerStatus = { state: "ok", snapshot, source: "shared-memory" };
const stale: PollerStatus = { state: "stale", snapshot, source: "shared-memory", staleForMs: 42_000 };
const down: PollerStatus = { state: "unavailable", reason: "not-running", message: "gone" };

applyGlobalThemeSettings({ theme: "void", typeAccents: "on" });

describe("preview identity and face", () => {
	it("carries the context, the kind and the device face verbatim", () => {
		const face = "<svg xmlns='http://www.w3.org/2000/svg'><text>67.4</text></svg>";
		const p = buildPreview(ok, { readingKey: "cpu:0:0" }, true, { context: "ctx-A", kind: "key", face });
		assert.equal(p.context, "ctx-A");
		assert.equal(p.kind, "key");
		assert.equal(p.face, face);
	});
	it("omits a face it was not handed, an empty one, and one past the size bound", () => {
		assert.equal(buildPreview(ok, { readingKey: "cpu:0:0" }, true, {}).face, undefined);
		assert.equal(buildPreview(ok, { readingKey: "cpu:0:0" }, true, { face: "" }).face, undefined);
		assert.equal(buildPreview(ok, { readingKey: "cpu:0:0" }, true, { face: "x".repeat(64 * 1024 + 1) }).face, undefined);
	});
	it("names the primary reading, its source and its display unit", () => {
		const p = buildPreview(ok, { readingKey: "cpu:0:0", fahrenheit: true }, true, { kind: "key" });
		assert.deepEqual(p.reading, { label: "CPU Tctl", source: "CPU [#0]", unit: "°F" });
	});
});

describe("data state truthfulness", () => {
	it("an unavailable source is not a missing reading", () => {
		const p = buildPreview(down, { readingKey: "cpu:0:0" }, true, { kind: "key" });
		assert.equal(p.state, "unavailable");
		assert.equal(p.missing, false);
		assert.equal(p.display, undefined);
	});
	it("a stale source stays stale, with its reading resolved", () => {
		const p = buildPreview(stale, { readingKey: "cpu:0:0" }, true, { kind: "key" });
		assert.equal(p.state, "stale");
		assert.equal(p.missing, false);
		assert.match(p.hint, /42s ago/);
	});
	it("a reading absent from a healthy snapshot is missing", () => {
		assert.equal(buildPreview(ok, { readingKey: "gone:0:0" }, true, { kind: "key" }).missing, true);
	});
	it("valid zero and negative values stay values", () => {
		// Formatted by the runtime's own auto-decimals rule; a number, never a placeholder.
		assert.equal(Number(buildPreview(ok, { readingKey: "fan:0:0" }, true, { kind: "key" }).display?.value), 0);
		assert.match(buildPreview(ok, { readingKey: "off:0:0" }, true, { kind: "key" }).display?.value ?? "", /^-/);
	});
});

describe("effective presentation", () => {
	it("an own theme is own, an empty one follows the shared default", () => {
		assert.deepEqual(buildPreview(ok, { readingKey: "cpu:0:0", theme: "ember" }, true, { kind: "key" }).effective?.theme, { id: "ember", drawn: "ember", own: true, unknown: false });
		assert.deepEqual(buildPreview(ok, { readingKey: "cpu:0:0", theme: "" }, true, { kind: "key" }).effective?.theme, { id: "void", drawn: "void", own: false, unknown: false });
	});
	it("an unknown stored theme is kept as the id and reported as drawing the spec default", () => {
		const theme = buildPreview(ok, { readingKey: "cpu:0:0", theme: "neon" }, true, { kind: "key" }).effective?.theme;
		assert.deepEqual(theme, { id: "neon", drawn: loadThemes().defaultTheme, own: true, unknown: true });
	});
	it("the local Text setting wins; Custom without a valid color draws theme text", () => {
		applyGlobalThemeSettings({ theme: "void", typeAccents: "on", textMode: "dim" });
		assert.deepEqual(buildPreview(ok, { readingKey: "cpu:0:0" }, true, { kind: "key" }).effective?.text, { mode: "dim", applied: "dim", own: false, color: null, dimSecondary: false });
		assert.deepEqual(buildPreview(ok, { readingKey: "cpu:0:0", textMode: "custom", textColor: "red" }, true, { kind: "key" }).effective?.text, { mode: "custom", applied: "theme", own: true, color: null, dimSecondary: false });
		assert.deepEqual(buildPreview(ok, { readingKey: "cpu:0:0", textMode: "custom", textColor: "#8A2B2B", textDimSecondary: true }, true, { kind: "key" }).effective?.text, { mode: "custom", applied: "custom", own: true, color: "#8A2B2B", dimSecondary: true });
		applyGlobalThemeSettings({ theme: "void", typeAccents: "on", textMode: "theme" });
	});
	it("type accents report off on the theme that suppresses them", () => {
		assert.equal(buildPreview(ok, { readingKey: "cpu:0:0" }, true, { kind: "key" }).effective?.typeAccents, true);
		assert.equal(buildPreview(ok, { readingKey: "cpu:0:0", theme: "paper" }, true, { kind: "key" }).effective?.typeAccents, !loadThemes().typeAccentsDisabledOn.includes("paper"));
	});
	it("thresholds parse like the runtime (decimal comma, junk ignored) and compare at or beyond", () => {
		const a = buildPreview(ok, { readingKey: "cpu:0:0", warnValue: "60,5", critValue: "hot" }, true, { kind: "key" }).effective?.alert;
		assert.deepEqual(a, { level: "warn", warn: 60.5, crit: null, below: false, unit: "°C", applies: true, scopeUnit: null });
		const f = buildPreview(ok, { readingKey: "cpu:0:0", fahrenheit: true, critValue: "153" }, true, { kind: "key" }).effective?.alert;
		assert.equal(f?.level, "crit");
		assert.equal(f?.unit, "°F");
	});
	it("a dial's thresholds only apply in the unit they were set against", () => {
		const scoped = buildPreview(ok, { readingKey: "cpu:0:0", critValue: "50", alertUnit: "RPM" }, false, { kind: "dial" }).effective?.alert;
		assert.equal(scoped?.applies, false);
		assert.equal(scoped?.level, "normal");
		assert.equal(scoped?.scopeUnit, "RPM");
		assert.equal(buildPreview(ok, { readingKey: "cpu:0:0", critValue: "50", alertUnit: "°C" }, false, { kind: "dial" }).effective?.alert.level, "crit");
	});
	it("reports the key's drawn layout and press role, and the dial's resolved controls", () => {
		const key = buildPreview(ok, { readingKey: "cpu:0:0", keyLayout: "quad", detailRole: "back", pressBehavior: "open-details" } as never, true, { kind: "key" }).effective;
		assert.deepEqual(key?.layout, { chosen: "quad", drawn: "single" });
		assert.deepEqual(key?.press, { behavior: "open-details", role: "back", detailMode: "source", density: 1 });
		const dial = buildPreview(ok, { readingKey: "cpu:0:0", controlPreset: "elite" } as never, false, { kind: "dial" }).effective;
		assert.equal(dial?.controls?.preset, "elite");
		assert.equal(dial?.controls?.pressedRotate, "stepGroup");
		assert.equal(dial?.controls?.switchesGroups, true);
	});
});

describe("drawnKeyLayout is compose()'s gate", () => {
	const cases: Array<[string, Record<string, unknown>, string]> = [
		["quad with one pick", { readingKey: "cpu:0:0", keyLayout: "quad" }, "single"],
		["quad with two picks", { readingKey: "cpu:0:0", quadReadingKey4: "fan:0:0", keyLayout: "quad" }, "quad"],
		["triple ignores slot 4", { readingKey: "cpu:0:0", quadReadingKey4: "fan:0:0", keyLayout: "triple" }, "single"],
		["triple with slot 3", { readingKey: "cpu:0:0", quadReadingKey3: "fan:0:0", keyLayout: "triple" }, "triple"],
		["dual needs slot 2", { readingKey: "cpu:0:0", quadReadingKey3: "fan:0:0", keyLayout: "dual" }, "single"],
		["dual", { readingKey: "cpu:0:0", secondaryReadingKey: "fan:0:0", keyLayout: "dual" }, "dual"],
		["future marker", { readingKey: "cpu:0:0", secondaryReadingKey: "fan:0:0", keyLayout: "hex" }, "single"],
		["non-string slot", { readingKey: "cpu:0:0", secondaryReadingKey: 7, keyLayout: "dual" }, "single"]
	];
	for (const [name, settings, expected] of cases) {
		it(`${name} draws ${expected}`, () => {
			assert.equal(drawnKeyLayout(settings), expected);
			if (expected === "single") {
				// A degraded layout renders byte-identical to the plain single key.
				assert.equal(compose(settings as never, ok), compose({ readingKey: "cpu:0:0" }, ok));
			} else {
				assert.notEqual(compose(settings as never, ok), compose({ readingKey: "cpu:0:0" }, ok));
			}
		});
	}
});
