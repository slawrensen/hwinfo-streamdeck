import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, it } from "node:test";

import { dialGalleryFixture, renderGalleryDial } from "../scripts/lib/dial-gallery";
import { composeDialSvg, type DialSettings } from "../src/actions/sensor-dial";
import { SensorType, type Reading } from "../src/hwinfo/types";
import { applyReadingLinks } from "../src/hwinfo/reading-links";
import { stepReading } from "../src/rotation";
import { DIM_VALUE_BLEND, mixToward, readableValueColor } from "../src/ui/text-colors";
import { applyGlobalThemeSettings } from "../src/ui/theme-store";
import { alertValueColor, classifyTypeAccent, loadThemes } from "../src/ui/themes";
import { contrast } from "./wcag";

const config = loadThemes();
type Fixture = ReturnType<typeof dialGalleryFixture>;
const compose = ({ state, snapshot, historyOf }: Fixture): string => composeDialSvg(state, { state: "ok", snapshot, source: "shared-memory" }, historyOf);
const values = (svg: string): string[] => [...svg.matchAll(/font-weight="700" fill="([^"]+)">[^<]+<\/text>/g)].map((m) => m[1]!);
const withoutValues = (svg: string): string => svg.replace(/(font-weight="700" fill=")[^"]+/g, "$1VALUE");

it("contrast primitive keeps passing colors exact and quantized corrections above 4.5 on either polarity", () => {
	for (const bg of ["#000000", "#FFFFFF", "#777777", "#2A2F3A", "#CDC9BD"]) {
		for (const color of ["#777777", "#000000", "#FFFFFF", ...Object.values(config.typeAccents)]) {
			const resolved = readableValueColor(color, bg);
			assert.ok(contrast(resolved, bg) >= 4.5, `${resolved} on ${bg}`);
			if (contrast(color, bg) >= 4.5) assert.equal(resolved, color);
		}
	}
});

beforeEach(() => applyGlobalThemeSettings({ theme: "void", typeAccents: "on", textMode: "theme" }));

it("confirmed source links preserve individual colors in curated and uncurated overview rows without changing settings", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const curated of [false, true]) {
			const fixture = dialGalleryFixture("overview");
			fixture.state.settings.dialView = view;
			fixture.state.settings.readingColors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" };
			if (!curated) delete fixture.state.settings.rotationKeys;
			const saved = structuredClone(fixture.state.settings);
			const original = fixture.snapshot;
			const expected = values(compose(fixture));
			const links = original.readings.map((r, i) => ({ sharedMemory: r.key, gadget: `g:Sample:Reading${i}`, unit: r.unit, sensorType: r.type }));
			const readings = original.readings.map((r, i) => ({ ...r, key: links[i]!.gadget }));
			fixture.snapshot = applyReadingLinks({ ...original, readings, byKey: new Map(readings.map((r) => [r.key, r])) }, links, 1);
			assert.deepEqual(values(compose(fixture)), expected, `${view}, curated=${curated}`);
			fixture.snapshot = applyReadingLinks(original, links, 1);
			assert.deepEqual(values(compose(fixture)), expected);
			assert.deepEqual(fixture.state.settings, saved);
		}
	}
});

it("unlinked lookalike readings do not inherit colors and an explicit live-key color wins over its linked endpoint", () => {
	const fixture = dialGalleryFixture("overview");
	delete fixture.state.settings.rotationKeys;
	fixture.state.settings.readingColors = { "31:0:2": "#FF7E8E" };
	const original = fixture.snapshot;
	const readings = original.readings.map((r, i) => i === 1 ? { ...r, key: "g:Sample:GPU" } : r);
	fixture.snapshot = { ...original, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	assert.notEqual(values(compose(fixture))[1], "#FF7E8E");
	fixture.snapshot = applyReadingLinks(fixture.snapshot, [{ sharedMemory: "31:0:2", gadget: "g:Sample:GPU", unit: "°C", sensorType: SensorType.Temperature }], 1);
	assert.equal(values(compose(fixture))[1], "#FF7E8E");
	fixture.state.settings.readingColors["g:Sample:GPU"] = "#4CC2FF";
	assert.equal(values(compose(fixture))[1], "#4CC2FF");
});

for (const view of ["overview", "tworow"] as const) {
	it(`issue #31: production ${view} composition colors values by type`, () => {
		const { state, snapshot, historyOf } = dialGalleryFixture(view, true);
		const svg = composeDialSvg(state, { state: "ok", snapshot, source: "shared-memory" }, historyOf);
		const colors = [...svg.matchAll(/font-weight="700" fill="([^"]+)">[^<]+<\/text>/g)].map((m) => m[1]);
		const accents = loadThemes().typeAccents;
		assert.deepEqual(colors, view === "overview" ? [accents.temperature, accents.temperature, accents.fan] : [accents.power, accents.load]);
	});
}

/**
 * The 1.6.0 reference. test/golden/dial-color-baseline.json holds the fd1cab6
 * sha256 of 63 default-settings faces (3 views x 7 themes x 3 text modes),
 * captured on the 1.6.0 renderer. 1.7 draws 40 of them differently, and only
 * in text fills; SINCE_1_6_0 names every moved role with its 1.6.0 and 1.7
 * token. The test puts exactly those fills back and requires the 1.6.0 hash,
 * so any other byte change fails, a stale entry fails, and a missing entry
 * fails. Keys absent from the table are byte-identical to 1.6.0 (all 21
 * Custom faces, and the single and overview faces on Paper in Theme).
 *
 * Why the 40 moved: every theme's unit token rose to the numeric 4.5:1 floor
 * in themes.json (units and statistics are numbers); the Dim mode lifts its
 * unit to that floor and then its label to the unit's ratio, so Dim keeps
 * the label over unit hierarchy; the selected two-row band (the track)
 * resolves its unit there, and the Dim value is lifted on that surface too;
 * Ember and Paper in Dim also lift the value to the floor.
 */
const HEX = "(#[0-9A-F]{6})";
const ROLES: Record<string, Record<string, RegExp>> = {
	single: {
		title: new RegExp(`(<text x="12" y="24" [^>]*fill=")${HEX}`, "g"),
		value: new RegExp(`(<text x="12" y="58" [^>]*fill=")${HEX}`, "g"),
		unit: new RegExp(`(<tspan dx="6" font-size="17" font-weight="600" fill=")${HEX}`, "g"),
		stats: new RegExp(`(<text x="12" y="78" [^>]*fill=")${HEX}`, "g")
	},
	tworow: {
		selectedLabel: new RegExp(`(<text x="12" y="(?:17|40)" [^>]*fill=")${HEX}`, "g"),
		selectedValue: new RegExp(`(<text x="[0-9.]+" y="40" text-anchor="end" [^>]*fill=")${HEX}`, "g"),
		selectedUnit: new RegExp(`(<text x="[0-9]+[.][0-9]" y="40" text-anchor="start" [^>]*fill=")${HEX}`, "g"),
		unselectedLabel: new RegExp(`(<text x="12" y="(?:59|82)" [^>]*fill=")${HEX}`, "g"),
		unselectedValue: new RegExp(`(<text x="[0-9.]+" y="82" text-anchor="end" [^>]*fill=")${HEX}`, "g"),
		unselectedUnit: new RegExp(`(<text x="[0-9]+[.][0-9]" y="82" text-anchor="start" [^>]*fill=")${HEX}`, "g"),
		footer: new RegExp(`(<text x="6" y="96" [^>]*fill=")${HEX}`, "g")
	},
	overview: {
		selectedLabel: new RegExp(`(letter-spacing="0.4" fill=")${HEX}(">CPU TEMP<)`, "g"),
		unselectedLabels: new RegExp(`(letter-spacing="0.4" fill=")${HEX}(">(?:GPU TEMP|PUMP)<)`, "g"),
		values: new RegExp(`(<text x="168" y="[0-9.]+" text-anchor="end" [^>]*fill=")${HEX}`, "g"),
		units: new RegExp(`(<text x="172" y="[0-9.]+" text-anchor="start" [^>]*fill=")${HEX}`, "g"),
		context: new RegExp(`(<text x="2" y="11" [^>]*fill=")${HEX}`, "g"),
		stats: new RegExp(`(<text x="196" y="11" text-anchor="end" [^>]*fill=")${HEX}`, "g")
	}
};
const SINCE_1_6_0: Record<string, Record<string, readonly [before: string, after: string]>> = {
	"single/void/theme": { unit: ["#667082", "#6B7586"], stats: ["#667082", "#6B7586"] },
	"single/void/dim": { title: ["#555C67", "#6F757E"], unit: ["#474E5B", "#6F757E"], stats: ["#474E5B", "#6F757E"] },
	"single/graphite/theme": { unit: ["#757F91", "#7A8495"], stats: ["#757F91", "#7A8495"] },
	"single/graphite/dim": { title: ["#696F7C", "#7E848F"], unit: ["#5A6170", "#7D848F"], stats: ["#5A6170", "#7D848F"] },
	"single/ultraviolet/theme": { unit: ["#7C6C9F", "#8171A2"], stats: ["#7C6C9F", "#8171A2"] },
	"single/ultraviolet/dim": { title: ["#695B83", "#7F7496"], unit: ["#5C4D79", "#7F7495"], stats: ["#5C4D79", "#7F7495"] },
	"single/midnight/theme": { unit: ["#627896", "#687E9A"], stats: ["#627896", "#687E9A"] },
	"single/midnight/dim": { title: ["#566780", "#6E7D92"], unit: ["#475973", "#6E7D90"], stats: ["#475973", "#6E7D90"] },
	"single/forest/theme": { unit: ["#5D7D6F", "#638274"], stats: ["#5D7D6F", "#638274"] },
	"single/forest/dim": { title: ["#526B5E", "#6B8175"], unit: ["#435D51", "#6B8076"], stats: ["#435D51", "#6B8076"] },
	"single/ember/theme": { unit: ["#8A6326", "#926E35"], stats: ["#8A6326", "#926E35"] },
	"single/ember/dim": { title: ["#735323", "#8B7149"], value: ["#946B2D", "#956D2F"], unit: ["#61451B", "#857252"], stats: ["#61451B", "#857252"] },
	"single/paper/dim": { title: ["#7A776F", "#6A6761"], value: ["#6D6B65", "#696762"], unit: ["#8A867A", "#6B675E"], stats: ["#8A867A", "#6B675E"] },
	"tworow/void/theme": { selectedUnit: ["#667082", "#798292"], unselectedLabel: ["#667082", "#6B7586"], unselectedUnit: ["#667082", "#6B7586"], footer: ["#667082", "#6B7586"] },
	"tworow/void/dim": { selectedLabel: ["#555C67", "#7C828C"], selectedValue: ["#949494", "#9D9FA2"], selectedUnit: ["#474E5B", "#7C828C"], unselectedLabel: ["#474E5B", "#6F757E"], unselectedUnit: ["#474E5B", "#6F757E"], footer: ["#474E5B", "#6F757E"] },
	"tworow/graphite/theme": { selectedLabel: ["#8B93A3", "#8E96A5"], selectedUnit: ["#757F91", "#8E96A5"], unselectedLabel: ["#757F91", "#7A8495"], unselectedUnit: ["#757F91", "#7A8495"], footer: ["#757F91", "#7A8495"] },
	"tworow/graphite/dim": { selectedLabel: ["#696F7C", "#9096A1"], selectedValue: ["#989A9F", "#9FA2A9"], selectedUnit: ["#5A6170", "#9096A1"], unselectedLabel: ["#5A6170", "#7D848F"], unselectedUnit: ["#5A6170", "#7D848F"], footer: ["#5A6170", "#7D848F"] },
	"tworow/ultraviolet/theme": { selectedUnit: ["#7C6C9F", "#8D7FAB"], unselectedLabel: ["#7C6C9F", "#8171A2"], unselectedUnit: ["#7C6C9F", "#8171A2"], footer: ["#7C6C9F", "#8171A2"] },
	"tworow/ultraviolet/dim": { selectedLabel: ["#695B83", "#8C80A4"], selectedValue: ["#948CA1", "#9D92B0"], selectedUnit: ["#5C4D79", "#8C80A4"], unselectedLabel: ["#5C4D79", "#7F7495"], unselectedUnit: ["#5C4D79", "#7F7495"], footer: ["#5C4D79", "#7F7495"] },
	"tworow/midnight/theme": { selectedUnit: ["#627896", "#768AA3"], unselectedLabel: ["#627896", "#687E9A"], unselectedUnit: ["#627896", "#687E9A"], footer: ["#627896", "#687E9A"] },
	"tworow/midnight/dim": { selectedLabel: ["#566780", "#7B8A9F"], selectedValue: ["#8E96A1", "#939DAB"], selectedUnit: ["#475973", "#7B8A9E"], unselectedLabel: ["#475973", "#6E7D90"], unselectedUnit: ["#475973", "#6E7D90"], footer: ["#475973", "#6E7D90"] },
	"tworow/forest/theme": { selectedUnit: ["#5D7D6F", "#748F83"], unselectedLabel: ["#5D7D6F", "#638274"], unselectedUnit: ["#5D7D6F", "#638274"], footer: ["#5D7D6F", "#638274"] },
	"tworow/forest/dim": { selectedLabel: ["#526B5E", "#798E83"], selectedValue: ["#8B9A91", "#90A298"], selectedUnit: ["#435D51", "#798E83"], unselectedLabel: ["#435D51", "#6B8076"], unselectedUnit: ["#435D51", "#6B8076"], footer: ["#435D51", "#6B8076"] },
	"tworow/ember/theme": { selectedUnit: ["#8A6326", "#9A7944"], unselectedLabel: ["#8A6326", "#926E35"], unselectedUnit: ["#8A6326", "#926E35"], footer: ["#8A6326", "#926E35"] },
	"tworow/ember/dim": { selectedLabel: ["#735323", "#967A51"], selectedValue: ["#946B2D", "#A37633"], selectedUnit: ["#61451B", "#917B59"], unselectedLabel: ["#61451B", "#857252"], unselectedValue: ["#946B2D", "#956D2F"], unselectedUnit: ["#61451B", "#857252"], footer: ["#61451B", "#857252"] },
	"tworow/paper/theme": { selectedUnit: ["#615D4F", "#595548"] },
	"tworow/paper/dim": { selectedLabel: ["#7A776F", "#57554F"], selectedValue: ["#6D6B65", "#57554E"], selectedUnit: ["#8A867A", "#58554C"], unselectedLabel: ["#8A867A", "#6B675E"], unselectedValue: ["#6D6B65", "#696762"], unselectedUnit: ["#8A867A", "#6B675E"], footer: ["#8A867A", "#6B675E"] },
	"overview/void/theme": { unselectedLabels: ["#667082", "#6B7586"], units: ["#667082", "#6B7586"], stats: ["#667082", "#6B7586"] },
	"overview/void/dim": { selectedLabel: ["#555C67", "#6F757E"], unselectedLabels: ["#474E5B", "#6F757E"], units: ["#474E5B", "#6F757E"], context: ["#555C67", "#6F757E"], stats: ["#474E5B", "#6F757E"] },
	"overview/graphite/theme": { unselectedLabels: ["#757F91", "#7A8495"], units: ["#757F91", "#7A8495"], stats: ["#757F91", "#7A8495"] },
	"overview/graphite/dim": { selectedLabel: ["#696F7C", "#7E848F"], unselectedLabels: ["#5A6170", "#7D848F"], units: ["#5A6170", "#7D848F"], context: ["#696F7C", "#7E848F"], stats: ["#5A6170", "#7D848F"] },
	"overview/ultraviolet/theme": { unselectedLabels: ["#7C6C9F", "#8171A2"], units: ["#7C6C9F", "#8171A2"], stats: ["#7C6C9F", "#8171A2"] },
	"overview/ultraviolet/dim": { selectedLabel: ["#695B83", "#7F7496"], unselectedLabels: ["#5C4D79", "#7F7495"], units: ["#5C4D79", "#7F7495"], context: ["#695B83", "#7F7496"], stats: ["#5C4D79", "#7F7495"] },
	"overview/midnight/theme": { unselectedLabels: ["#627896", "#687E9A"], units: ["#627896", "#687E9A"], stats: ["#627896", "#687E9A"] },
	"overview/midnight/dim": { selectedLabel: ["#566780", "#6E7D92"], unselectedLabels: ["#475973", "#6E7D90"], units: ["#475973", "#6E7D90"], context: ["#566780", "#6E7D92"], stats: ["#475973", "#6E7D90"] },
	"overview/forest/theme": { unselectedLabels: ["#5D7D6F", "#638274"], units: ["#5D7D6F", "#638274"], stats: ["#5D7D6F", "#638274"] },
	"overview/forest/dim": { selectedLabel: ["#526B5E", "#6B8175"], unselectedLabels: ["#435D51", "#6B8076"], units: ["#435D51", "#6B8076"], context: ["#526B5E", "#6B8175"], stats: ["#435D51", "#6B8076"] },
	"overview/ember/theme": { unselectedLabels: ["#8A6326", "#926E35"], units: ["#8A6326", "#926E35"], stats: ["#8A6326", "#926E35"] },
	"overview/ember/dim": { selectedLabel: ["#735323", "#8B7149"], unselectedLabels: ["#61451B", "#857252"], values: ["#946B2D", "#956D2F"], units: ["#61451B", "#857252"], context: ["#735323", "#8B7149"], stats: ["#61451B", "#857252"] },
	"overview/paper/dim": { selectedLabel: ["#7A776F", "#6A6761"], unselectedLabels: ["#8A867A", "#6B675E"], values: ["#6D6B65", "#696762"], units: ["#8A867A", "#6B675E"], context: ["#7A776F", "#6A6761"], stats: ["#8A867A", "#6B675E"] }
};
const golden = JSON.parse(readFileSync(new URL("./golden/dial-color-baseline.json", import.meta.url), "utf8")) as Record<string, string>;
const sha256 = (svg: string): string => createHash("sha256").update(svg).digest("hex");
const roleFills = (svg: string, re: RegExp): string[] => [...svg.matchAll(re)].map((m) => m[2] as string);
const goldenFixture = (key: string): Fixture => {
	const [view, theme, textMode] = key.split("/");
	const fixture = dialGalleryFixture(view === "overview" ? "overview" : "tworow");
	fixture.state.settings = { ...fixture.state.settings, dialView: view, theme, textMode, textColor: "#123abc" } as DialSettings;
	return fixture;
};
/** The face as 1.6.0 drew it: each enumerated role's fill put back, after
 * checking that the face draws that role in the enumerated 1.7 token and
 * that every text fill on the face belongs to some role. */
const asOf160 = (key: string, svg: string): string => {
	const view = key.split("/")[0] as string;
	const roles = ROLES[view] as Record<string, RegExp>;
	const moved = SINCE_1_6_0[key] ?? {};
	const claimed = Object.values(roles).reduce((n, re) => n + roleFills(svg, re).length, 0);
	assert.equal(claimed, (svg.match(/<(?:text|tspan)[^>]*fill="#[0-9A-F]{6}"/g) ?? []).length, `${key}: a text fill escapes the role table`);
	let reverted = svg;
	for (const [role, entry] of Object.entries(moved)) {
		const re = roles[role];
		assert.ok(re !== undefined, `${key}: unknown role ${role}`);
		const [before, after] = entry;
		assert.deepEqual([...new Set(roleFills(svg, re as RegExp))], [after], `${key}: ${role} draws ${after} now`);
		assert.notEqual(before, after);
		reverted = reverted.replace(re as RegExp, (m: string, _pre: string, fill: string) => m.replace(fill, before));
	}
	return reverted;
};

it("every raw sensorValueColors variant renders byte-identical to the undefined variant on every default face", () => {
	for (const key of Object.keys(golden)) {
		const view = key.split("/")[0] as string;
		const fixture = goldenFixture(key);
		fixture.state.settings = { ...fixture.state.settings, sensorValueColors: undefined } as DialSettings;
		const base = compose(fixture);
		for (const raw of [false, null, "true", "on", 1, {}, [], ...(view === "single" ? [true] : [])]) {
			fixture.state.settings = { ...fixture.state.settings, sensorValueColors: raw } as DialSettings;
			assert.equal(compose(fixture), base, `${key}, ${JSON.stringify(raw)}`);
		}
	}
});

it("default faces since 1.6.0: the fd1cab6 golden holds once exactly the enumerated text fills are put back", () => {
	assert.equal(Object.keys(golden).length, 63);
	assert.equal(Object.keys(SINCE_1_6_0).length, 40);
	for (const [key, expected] of Object.entries(golden)) {
		const svg = compose(goldenFixture(key));
		assert.equal(sha256(asOf160(key, svg)), expected, `${key}: bytes other than the enumerated fills differ from 1.6.0`);
		if (SINCE_1_6_0[key] !== undefined) assert.notEqual(sha256(svg), expected, `${key}: enumerated as moved but byte-identical to 1.6.0`);
	}
});

it("only numbers change; labels, units, footer, graphs and selection retain their bytes", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const textMode of ["theme", "dim", "custom"]) {
			const fixture = dialGalleryFixture(view);
			fixture.state.settings.textMode = textMode;
			fixture.state.settings.textColor = "#123abc";
			const off = compose(fixture);
			fixture.state.settings.sensorValueColors = true;
			assert.equal(withoutValues(compose(fixture)), withoutValues(off));
			if (textMode === "custom") assert.equal(compose(fixture), off);
		}
	}
});

it("rotation, selection and reordering follow reading category, never row position", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture("overview", true);
		fixture.state.settings.dialView = view;
		const { readings } = fixture.snapshot;
		for (const order of [readings, [...readings].reverse()]) {
			fixture.state.settings.rotationKeys = order.map((r) => r.key);
			for (let i = 0; i < order.length; i++) {
				fixture.state.settings.readingKey = stepReading(order, fixture.state.settings.readingKey, 1)?.key;
				const svg = compose(fixture);
				for (const r of readings) {
					const color = config.typeAccents[classifyTypeAccent(r.type, r.unit, r.label)!];
					const value = r.value.toString();
					if (svg.includes(`>${value}</text>`)) assert.ok(svg.includes(`fill="${color}">${value}</text>`), `${view}: ${r.key}`);
				}
			}
		}
	}
});

it("theme and Dim use the actual selected-row background and the shared contrast primitive", () => {
	for (const theme of Object.keys(config.themes)) {
		if (config.typeAccentsDisabledOn.includes(theme)) continue;
		for (const view of ["tworow", "overview"] as const) {
			for (const textMode of ["theme", "dim"]) {
				const fixture = dialGalleryFixture(view, true);
				Object.assign(fixture.state.settings, { theme, textMode });
				const palette = config.themes[theme]!;
				values(compose(fixture)).forEach((color, index) => {
					const bg = view === "tworow" && index === 0 ? palette.track : palette.bg;
					const r = fixture.snapshot.readings[index]!;
					const accent = config.typeAccents[classifyTypeAccent(r.type, r.unit, r.label)!];
					const dimmed = textMode === "dim" ? mixToward(accent, bg, DIM_VALUE_BLEND) : accent;
					assert.equal(color, readableValueColor(dimmed, bg));
					assert.ok(contrast(color, bg) >= 4.5, `${theme}/${view}/${textMode}/${index}: ${color} on ${bg}`);
				});
			}
		}
	}
});

it("Custom is exact, invalid Custom becomes Theme, and deck settings inherit without writes", () => {
	const fixture = dialGalleryFixture("tworow", true);
	delete fixture.state.settings.textMode;
	delete fixture.state.settings.theme;
	const saved = structuredClone(fixture.state.settings);
	applyGlobalThemeSettings({ theme: "graphite", textMode: "custom", textColor: "#123abc" });
	assert.deepEqual(values(compose(fixture)), ["#123abc", "#123abc"]);
	assert.deepEqual(fixture.state.settings, saved);
	fixture.state.settings.textMode = "theme";
	const themed = compose(fixture);
	fixture.state.settings.textMode = "custom";
	fixture.state.settings.textColor = "invalid";
	assert.equal(compose(fixture), themed);
	fixture.state.settings.textColor = "#000001";
	assert.deepEqual(values(compose(fixture)), ["#000001", "#000001"]);
	delete fixture.state.settings.textMode;
	applyGlobalThemeSettings({ theme: "graphite", textMode: "dim" });
	const inherited = compose(fixture);
	Object.assign(fixture.state.settings, { theme: "graphite", textMode: "dim" });
	assert.equal(compose(fixture), inherited);
});

it("accents off, Paper, unknown categories and nonnumeric values keep normal resolved text", () => {
	for (const view of ["tworow", "overview"] as const) {
		for (const mode of ["accents-off", "paper", "unknown", "nonnumeric"]) {
			const fixture = dialGalleryFixture(view);
			if (mode === "accents-off") applyGlobalThemeSettings({ typeAccents: "off" });
			else applyGlobalThemeSettings({ typeAccents: "on" });
			if (mode === "paper") fixture.state.settings.theme = "paper";
			if (mode === "unknown" || mode === "nonnumeric") {
				const readings = fixture.snapshot.readings.map((r) => ({ ...r, ...(mode === "unknown" ? { type: SensorType.Other } : { value: NaN }) }));
				fixture.snapshot = { ...fixture.snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
			}
			const normal = compose(fixture);
			fixture.state.settings.sensorValueColors = true;
			assert.equal(compose(fixture), normal, `${view}/${mode}`);
		}
	}
});

it("classification uses native units and source labels, regardless of display aliases", () => {
	const fixture = dialGalleryFixture("tworow", true);
	const readings: Reading[] = fixture.snapshot.readings.map((r, i) => ({ ...r, type: SensorType.Other, unit: i === 0 ? "MB/s" : "MB", label: i === 0 ? "Download" : "GPU Memory" }));
	fixture.snapshot = { ...fixture.snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	fixture.state.settings.rotationNames = Object.fromEntries(readings.map((r) => [r.key, "Temperature"]));
	fixture.state.settings.label = "Fan";
	assert.deepEqual(values(compose(fixture)), [config.typeAccents.network, config.typeAccents.memory]);
});

it("alerts keep priority over Custom and sensor colors, with native-unit scoping and recovery", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture("overview", true);
		const warnColor = alertValueColor(config, "warn", view === "tworow" ? config.themes.void!.track : config.themes.void!.bg);
		Object.assign(fixture.state.settings, { dialView: view, warnValue: "70", critValue: "75", alertUnit: "°C", textMode: "custom", textColor: "#123abc" });
		assert.deepEqual(values(compose(fixture)), view === "overview" ? [warnColor, alertValueColor(config, "crit", config.themes.void!.bg), "#123abc"] : [warnColor, alertValueColor(config, "crit", config.themes.void!.bg)]);
		Object.assign(fixture.state.settings, { warnValue: "80", critValue: "90", textMode: "theme" });
		assert.deepEqual(values(compose(fixture)), view === "overview" ? [config.typeAccents.temperature, config.typeAccents.temperature, config.typeAccents.fan] : [config.typeAccents.temperature, config.typeAccents.temperature]);
		fixture.state.settings.fahrenheit = true;
		fixture.state.settings.warnValue = "160";
		fixture.state.settings.critValue = "168";
		assert.deepEqual(values(compose(fixture)), view === "overview" ? [warnColor, alertValueColor(config, "crit", config.themes.void!.bg), config.typeAccents.fan] : [warnColor, alertValueColor(config, "crit", config.themes.void!.bg)]);
	}
});

it("the docs gallery draws the golden-pinned Void faces: what the runtime composes for those settings, not a look-alike", () => {
	// renderGalleryDial feeds the docs and marketplace images. Pinning it to
	// the stored 1.6.0 reference (through the same enumeration) means a
	// fixture or helper drift shows up here instead of in a screenshot.
	for (const view of ["tworow", "overview"] as const) {
		const key = `${view}/void/theme`;
		assert.equal(sha256(asOf160(key, renderGalleryDial(view))), golden[key], key);
		assert.notEqual(renderGalleryDial(view, true), renderGalleryDial(view), "the sensor color opt-in changes the gallery face");
	}
});

it("individual reading colors distinguish two temperatures and leave every non-value byte unchanged", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture("overview");
		fixture.state.settings.dialView = view;
		const before = compose(fixture);
		Object.assign(fixture.state.settings, { readingColors: { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" } });
		assert.deepEqual(values(compose(fixture)), ["#4CC2FF", "#FF7E8E", "#38CD89"].slice(0, view === "tworow" ? 2 : 3));
		assert.equal(withoutValues(compose(fixture)), withoutValues(before));
	}
});

it("individual colors salvage per entry, keep exact chosen hues and never rewrite settings", () => {
	for (const view of ["tworow", "overview"] as const) {
		const fixture = dialGalleryFixture(view, true);
		const [first, second] = fixture.snapshot.readings;
		const automatic = compose(fixture);
		for (const readingColors of [undefined, null, true, "#123456", [], { [first!.key]: "bad", [second!.key]: 123 }, Object.create({ [first!.key]: "#123456" })]) {
			Object.assign(fixture.state.settings, { readingColors });
			assert.equal(compose(fixture), automatic);
		}
		Object.assign(fixture.state.settings, { readingColors: { [first!.key]: "#012aBc", [second!.key]: "bad", future: { keep: true } } });
		const saved = structuredClone(fixture.state.settings);
		assert.equal(values(compose(fixture))[0], "#012aBc", "explicit choices bypass automatic contrast adjustment");
		assert.equal(values(compose(fixture))[1], values(automatic)[1]);
		assert.deepEqual(fixture.state.settings, saved);
		fixture.state.settings.dialView = "single";
		const single = compose(fixture);
		delete fixture.state.settings.readingColors;
		assert.equal(compose(fixture), single);
	}
});

it("individual colors survive rotation, selection, reordered groups, removal and re-adding", () => {
	const fixture = dialGalleryFixture("overview");
	const colors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" };
	fixture.state.settings.readingColors = colors;
	const readings = fixture.snapshot.readings;
	for (const view of ["tworow", "overview"] as const) {
		fixture.state.settings.dialView = view;
		for (const order of [readings, [...readings].reverse(), [readings[1]!, readings[2]!], readings]) {
			fixture.state.settings.rotationKeys = order.map((r) => r.key);
			for (const groups of [undefined, [{ keys: [order[0]!.key] }, { keys: order.slice(1).map((r) => r.key) }]]) {
				fixture.state.settings.rotationGroups = groups;
				for (const reading of order) {
					fixture.state.settings.readingKey = reading.key;
					const svg = compose(fixture);
					for (const r of order) {
						if (svg.includes(`>${r.value}</text>`)) assert.ok(svg.includes(`fill="${colors[r.key as keyof typeof colors]}">${r.value}</text>`));
					}
				}
			}
		}
	}
	assert.deepEqual(fixture.state.settings.readingColors, colors);
});

it("individual colors work with accents off and Paper, follow Dim and inherited Custom, and preserve alert scoping", () => {
	const fixture = dialGalleryFixture("overview");
	fixture.state.settings.readingColors = { "31:0:1": "#4CC2FF", "31:0:2": "#FF7E8E", "31:0:3": "#38CD89" };
	for (const theme of Object.keys(config.themes)) {
		for (const view of ["tworow", "overview"] as const) {
			applyGlobalThemeSettings({ theme, typeAccents: "off", textMode: "theme" });
			Object.assign(fixture.state.settings, { theme, dialView: view, textMode: "theme" });
			const chosen = ["#4CC2FF", "#FF7E8E", "#38CD89"].slice(0, view === "tworow" ? 2 : 3);
			assert.deepEqual(values(compose(fixture)), chosen);
			fixture.state.settings.textMode = "dim";
			assert.deepEqual(values(compose(fixture)), chosen.map((color, i) => mixToward(color, view === "tworow" && i === 0 ? config.themes[theme]!.track : config.themes[theme]!.bg, DIM_VALUE_BLEND)));
			delete fixture.state.settings.textMode;
			applyGlobalThemeSettings({ textMode: "custom", textColor: "#123abc" });
			assert.deepEqual(values(compose(fixture)), chosen.map(() => "#123abc"));
			fixture.state.settings.textMode = "custom";
			fixture.state.settings.textColor = "invalid";
			assert.deepEqual(values(compose(fixture)), chosen);
		}
	}
	Object.assign(fixture.state.settings, { theme: "void", dialView: "overview", textMode: "theme", warnValue: "70", critValue: "75", alertUnit: "°C" });
	assert.deepEqual(values(compose(fixture)), [alertValueColor(config, "warn", config.themes.void!.bg), alertValueColor(config, "crit", config.themes.void!.bg), "#38CD89"]);
	Object.assign(fixture.state.settings, { warnValue: "80", critValue: "90" });
	assert.deepEqual(values(compose(fixture)), ["#4CC2FF", "#FF7E8E", "#38CD89"]);
	const readings = fixture.snapshot.readings.map((r) => ({ ...r, type: SensorType.Other, value: NaN }));
	fixture.snapshot = { ...fixture.snapshot, readings, byKey: new Map(readings.map((r) => [r.key, r])) };
	const missing = compose(fixture);
	delete fixture.state.settings.readingColors;
	assert.equal(compose(fixture), missing);
});
