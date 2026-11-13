/**
 * Ember Option B, measured. A dial in alert changes only its bar fill, so
 * the fill must read as different from the bar's normal color. This records
 * the CIEDE2000 distance from every normal bar color (each theme's accent,
 * and each type accent) to the warning and critical fills, as themes.json
 * ships them. themes.json is not changed: where a normal color sits within
 * ALERT_TRACK_DISTANCE of the fill (Ember's accent against warning, 3.26),
 * the alert also paints the unfilled track, and nowhere else.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALERT_TRACK_DISTANCE, alertTrackFill, barNeedsAlertTrack } from "../src/ui/alert-track";
import { ciede2000 } from "../src/ui/color-difference";
import { drawnZones } from "../src/ui/gauge";
import { loadThemes } from "../src/ui/themes";
import { contrast } from "./wcag";

const config = loadThemes();

/** Theme accents: [accent, ΔE00 to the warning fill, ΔE00 to the critical fill]. */
const THEME_ACCENTS: Readonly<Record<string, readonly [string, number, number]>> = {
	void: ["#4CC2FF", 54.59, 61.79],
	graphite: ["#55C7FF", 53.53, 62.89],
	ultraviolet: ["#C08BFF", 56.33, 45.9],
	midnight: ["#6FCFFF", 51.76, 63.14],
	forest: ["#3FE09A", 47.1, 76.3],
	ember: ["#E0912F", 3.26, 31.56],
	paper: ["#3B382E", 49.77, 34.09]
};

/** Type accents (they replace the theme accent on the bar when enabled). */
const TYPE_ACCENTS: Readonly<Record<string, readonly [string, number, number]>> = {
	temperature: ["#FF7E8E", 35.98, 27.33],
	fan: ["#3FBEDD", 48.39, 68.53],
	power: ["#D4AB33", 11.95, 43.6],
	clock: ["#38CD89", 45.77, 73.78],
	load: ["#B195FF", 54.91, 46.91],
	network: ["#6FA7FF", 52.19, 52.17],
	memory: ["#CE8BE0", 52.63, 42.16]
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

describe("normal bar color against the alert fills, as shipped", () => {
	it("the alert fills are the ones measured here", () => {
		assert.equal(config.alerts.warn.bg, "#E8940D");
		assert.equal(config.alerts.crit.bg, "#CB2114");
	});

	it("records every theme accent", () => {
		assert.deepEqual(Object.keys(config.themes).sort(), Object.keys(THEME_ACCENTS).sort());
		for (const [name, [accent, warn, crit]] of Object.entries(THEME_ACCENTS)) {
			assert.equal(config.themes[name]?.accent, accent, `${name} accent`);
			assert.equal(round2(ciede2000(accent, config.alerts.warn.bg)), warn, `${name} vs warning`);
			assert.equal(round2(ciede2000(accent, config.alerts.crit.bg)), crit, `${name} vs critical`);
		}
	});

	it("records every type accent", () => {
		assert.deepEqual(Object.keys(config.typeAccents).sort(), Object.keys(TYPE_ACCENTS).sort());
		for (const [name, [accent, warn, crit]] of Object.entries(TYPE_ACCENTS)) {
			assert.equal(config.typeAccents[name as keyof typeof config.typeAccents], accent, `${name} accent`);
			assert.equal(round2(ciede2000(accent, config.alerts.warn.bg)), warn, `${name} vs warning`);
			assert.equal(round2(ciede2000(accent, config.alerts.crit.bg)), crit, `${name} vs critical`);
		}
	});

	it("only Ember's own accent against the warning fill is within the track limit", () => {
		const close: string[] = [];
		for (const [name, [accent]] of [...Object.entries(THEME_ACCENTS), ...Object.entries(TYPE_ACCENTS)]) {
			for (const level of ["warn", "crit"] as const) {
				if (barNeedsAlertTrack(accent, config.alerts[level].bg)) close.push(`${name} ${level}`);
			}
		}
		assert.deepEqual(close, ["ember warn"]);
		// The next closest pair (the power type accent) clears the limit.
		assert.ok(TYPE_ACCENTS.power![1] > ALERT_TRACK_DISTANCE);
	});
});

describe("alertTrackFill", () => {
	const ember = config.themes.ember!;

	it("paints Ember's track in the warning zone shade while warning", () => {
		const fill = alertTrackFill(ember.accent, "warn", config.alerts, ember.bg);
		assert.equal(fill, "#805107");
		// The same shade drawnZones gives a warning zone on that face.
		assert.equal(fill, drawnZones([{ from: 0, to: 1, level: "warn" }], config.alerts, ember.bg)[0]?.color);
		// Measured against the ordinary track it replaces.
		assert.equal(round2(contrast(fill, ember.track)), 2.69);
	});

	it("keeps the ordinary track at normal, at critical on Ember, and on every other bar color", () => {
		assert.equal(alertTrackFill(ember.accent, "normal", config.alerts, ember.bg), null);
		assert.equal(alertTrackFill(ember.accent, "crit", config.alerts, ember.bg), null);
		for (const [name, palette] of Object.entries(config.themes)) {
			const accents = name === "ember" ? Object.values(config.typeAccents) : [palette.accent, ...Object.values(config.typeAccents)];
			for (const accent of accents) {
				for (const level of ["normal", "warn", "crit"] as const) {
					assert.equal(alertTrackFill(accent, level, config.alerts, palette.bg), null, `${name} ${accent} ${level}`);
				}
			}
		}
	});

	it("follows the face background it is given", () => {
		assert.equal(alertTrackFill(ember.accent, "warn", config.alerts, "#FFFFFF"), drawnZones([{ from: 0, to: 1, level: "warn" }], config.alerts, "#FFFFFF")[0]?.color);
	});

	it("draws the line at the limit itself", () => {
		const alerts = { warn: { bg: "#808080" }, crit: { bg: "#CB2114" } };
		// Walk grays toward the fill until the distance first drops to the limit.
		let inside: string | undefined;
		let outside: string | undefined;
		for (let v = 0; v <= 255; v++) {
			const hex = `#${v.toString(16).padStart(2, "0").repeat(3)}`.toUpperCase();
			const distance = ciede2000(hex, "#808080");
			if (distance <= ALERT_TRACK_DISTANCE && inside === undefined) inside = hex;
			if (distance > ALERT_TRACK_DISTANCE) outside = hex;
			if (inside !== undefined) break;
		}
		assert.ok(inside !== undefined && outside !== undefined);
		assert.notEqual(alertTrackFill(inside, "warn", alerts, "#000000"), null);
		assert.equal(alertTrackFill(outside, "warn", alerts, "#000000"), null);
	});
});
