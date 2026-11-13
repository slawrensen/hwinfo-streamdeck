/**
 * Legacy invariance for dial alerts: a Sensor Dial whose settings carry only
 * the 1.7.1 alert fields composes byte for byte the faces it composed before
 * the alert store existed, both when the dial's tick steps the store (the
 * production stepDialAlerts, every tick, on monotonic time) and when a face
 * is composed with no step at all (samples and galleries). The golden is the
 * SHA-256 of every face test/dial-alerts-legacy-driver.ts composed against
 * the integration base (claude/release-1.8.0 at 616964b).
 *
 * The one deliberate change is Ember Option B: on Ember's single view, while
 * a level whose fill sits within CIEDE2000 10 of the bar's normal color
 * shows, the face is the 1.7.1 face plus exactly one track rectangle in the
 * level's zone shade.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { stepDialAlerts } from "../src/alerts/dial";
import { AlertStore } from "../src/alerts/store";
import { alertTrackFill } from "../src/ui/alert-track";
import { loadThemes, resolvePalette } from "../src/ui/themes";
import { DIAL_CASES, legacyDialFaces, TICKS } from "./dial-alerts-legacy-driver";

const golden = JSON.parse(readFileSync(new URL("./golden/dial-alerts-legacy-faces.json", import.meta.url), "utf8")) as Record<string, string[]>;

const sha = (svg: string): string => createHash("sha256").update(svg).digest("hex");

/** Ember's warning zone shade, the one track color Option B adds. */
const EMBER = resolvePalette(loadThemes(), "ember", null, "normal");
const EMBER_TRACK = alertTrackFill(EMBER.accent, "warn", loadThemes().alerts, EMBER.bg);
const TRACK_RECT = new RegExp(`<rect x="[\\d.]+" y="[\\d.]+" width="[\\d.]+" height="[\\d.]+" rx="[\\d.]+" fill="${EMBER_TRACK ?? "none"}"/>`, "g");

/** Either the 1.7.1 face, or (Ember's single view only) the 1.7.1 face plus
 * one track rectangle. Returns whether the track was there. */
function assertLegacy(name: string, tick: number, svg: string): boolean {
	const expected = golden[name]?.[tick];
	assert.notEqual(expected, undefined, `${name} tick ${tick} is in the golden`);
	if (sha(svg) === expected) return false;
	const emberSingle = (DIAL_CASES[name]?.theme === "ember") && DIAL_CASES[name]?.dialView === undefined;
	assert.ok(emberSingle, `${name} tick ${tick}: the face changed from 1.7.1`);
	const tracks = svg.match(TRACK_RECT) ?? [];
	assert.equal(tracks.length, 1, `${name} tick ${tick}: the only change is one Ember track rectangle`);
	assert.equal(sha(svg.replace(TRACK_RECT, "")), expected, `${name} tick ${tick}: without the track it is the 1.7.1 face`);
	return true;
}

describe("dials with only 1.7.1 alert settings compose the 1.7.1 faces", () => {
	it("the Ember warning track is the zone shade the design measured", () => {
		assert.equal(EMBER_TRACK, "#805107");
	});

	it("covers every case the golden holds, at every tick", () => {
		assert.deepEqual(Object.keys(DIAL_CASES).sort(), Object.keys(golden).sort());
		for (const list of Object.values(golden)) assert.equal(list.length, TICKS);
	});

	const stores = new Map<string, AlertStore>();
	const stepped = legacyDialFaces((name, settings, status, now) => {
		let store = stores.get(name);
		if (store === undefined) {
			store = new AlertStore();
			stores.set(name, store);
		}
		return stepDialAlerts(store, "ctx", settings, status, now);
	});
	const instant = legacyDialFaces();

	for (const name of Object.keys(DIAL_CASES)) {
		it(`${name}: stepped every tick`, () => {
			stepped[name]?.forEach((svg, tick) => assertLegacy(name, tick, svg));
		});
		it(`${name}: composed with no step`, () => {
			instant[name]?.forEach((svg, tick) => assertLegacy(name, tick, svg));
		});
	}

	it("Ember's single view lights its track exactly while the warning shows on a bar in Ember's accent", () => {
		// Voltages 1.0, 1.19, 1.2, 1.3, 1.4, 1.45, 1.39, 1.2, 1.1, NaN, 1.5,
		// 1.0 against warn 1.2 and critical 1.4: warn on ticks 2, 3, 6 and 7.
		// A voltage has no type accent, so its bar is Ember's own accent.
		const lit = (stepped["single, Ember voltage (no type accent)"] ?? []).map((svg, tick) => assertLegacy("single, Ember voltage (no type accent)", tick, svg));
		assert.deepEqual(lit, [false, false, true, true, false, false, true, true, false, false, false, false]);
		const instantLit = (instant["single, Ember voltage (no type accent)"] ?? []).map((svg, tick) => assertLegacy("single, Ember voltage (no type accent)", tick, svg));
		assert.deepEqual(instantLit, lit, "a face composed with no step lights the same ticks");
	});

	it("a temperature on Ember keeps its type accent bar and its 1.7.1 face", () => {
		const lit = (stepped["single, Ember"] ?? []).map((svg, tick) => assertLegacy("single, Ember", tick, svg));
		assert.ok(lit.every((value) => !value));
	});
});
